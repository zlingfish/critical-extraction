import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import * as YUKA from 'yuka';
import { addInventoryItem, applyDamage, canExtract, completeReload, createRunState } from './domain';
import type { EnemyState, InventoryItem, RunState } from './types';

interface GameCallbacks {
  onUpdate: (run: RunState) => void;
  onPrompt: (message: string | null) => void;
  onToast: (message: string, tone?: 'info' | 'danger') => void;
  onHit: (headshot: boolean) => void;
  onDamage: () => void;
  onCompass: (heading: string) => void;
  onControlCapture: (active: boolean) => void;
  onControlStatus: (message: string) => void;
  onMiniMap: (view: unknown) => void;
  onLootSearch: (state: unknown) => void;
  onDeploying: (active: boolean) => void;
  onPause: () => void;
  onEnd: (run: RunState, successful: boolean) => void;
}

interface LootRuntime {
  mesh: THREE.Group;
  position: THREE.Vector3;
  item: InventoryItem;
  opened: boolean;
}

interface EnemyRuntime {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  vehicle: YUKA.Vehicle;
  path: YUKA.Path;
  seek: YUKA.SeekBehavior;
  state: EnemyState;
  health: number;
  home: THREE.Vector3;
  facing: THREE.Vector3;
  lastSeen: THREE.Vector3;
  lastStateChange: number;
  fireCooldown: number;
  burstRemaining: number;
  alive: boolean;
}

interface TracerRuntime {
  line: THREE.Line;
  life: number;
}

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed || 1;
  }

  next(): number {
    this.state ^= this.state << 13;
    this.state ^= this.state >>> 17;
    this.state ^= this.state << 5;
    return (this.state >>> 0) / 4294967296;
  }

  pick<T>(values: T[]): T {
    return values[Math.floor(this.next() * values.length)] ?? values[0];
  }
}

class TacticalAudio {
  private context: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext();
      const length = Math.floor(this.context.sampleRate * 0.25);
      this.noiseBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) {
        data[index] = Math.random() * 2 - 1;
      }
    }
    void this.context.resume();
  }

  shot(volume = 0.18): void {
    if (!this.context || !this.noiseBuffer) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, now);
    filter.frequency.exponentialRampToValueAtTime(150, now + 0.16);
    gain.gain.setValueAtTime(volume * this.volumeScale, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    source.connect(filter).connect(gain).connect(this.context.destination);
    source.start(now);
    source.stop(now + 0.22);
  }

  tone(frequency: number, duration: number, volume: number): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }
}

const LOOT_TABLE: InventoryItem[] = [
  { id: 'copper-wire', name: '工业铜线', kind: 'supplies', rarity: 'common', value: 280, quantity: 1 },
  { id: 'field-bandage', name: '野战绷带', kind: 'medical', rarity: 'common', value: 340, quantity: 1 },
  { id: 'tool-kit', name: '精密工具组', kind: 'supplies', rarity: 'rare', value: 780, quantity: 1 },
  { id: 'radio-module', name: '加密通信模块', kind: 'electronics', rarity: 'rare', value: 960, quantity: 1 },
  { id: 'thermal-core', name: '热成像核心', kind: 'electronics', rarity: 'valuable', value: 1680, quantity: 1 },
  { id: 'access-token', name: '港区访问令牌', kind: 'intel', rarity: 'valuable', value: 2120, quantity: 1 },
];

const ENEMY_POSITIONS: Array<[number, number]> = [
  [-8, 20], [18, 18], [32, 2], [-27, -3], [-14, -18], [18, -24], [36, -34], [-32, 27],
];

const LOOT_POSITIONS: Array<[number, number]> = [
  [-38, 34], [-20, 26], [9, 28], [28, 15], [-29, -15], [-9, -20], [8, -7], [24, -15], [39, -7], [30, -38],
];

const EXTRACTION_POINT = { x: 44, z: -58 };
const SPAWN_POINT = { x: 0, z: 35 };
const FALL_RECOVERY_Y = -5;

export class CriticalExtractionGame {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: GameCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.04, 420);
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly audio = new TacticalAudio();
  private readonly keys = new Set<string>();
  private readonly blockers: THREE.Object3D[] = [];
  private readonly tracers: TracerRuntime[] = [];
  private readonly loot: LootRuntime[] = [];
  private readonly enemies: EnemyRuntime[] = [];
  private readonly enemyHitMeshes: THREE.Object3D[] = [];
  private entityManager = new YUKA.EntityManager();
  private physicsWorld!: RAPIER.World;
  private playerBody!: RAPIER.RigidBody;
  private playerCollider!: RAPIER.Collider;
  private characterController!: RAPIER.KinematicCharacterController;
  private run = createRunState();
  private objectiveCase!: THREE.Group;
  private extractionMarker!: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private weapon!: THREE.Group;
  private muzzleFlash!: THREE.Mesh;
  private nearestInteraction: LootRuntime | 'objective' | null = null;
  private yaw = 0;
  private pitch = 0;
  private verticalVelocity = 0;
  private cameraHeight = 0.62;
  private firing = false;
  private aiming = false;
  private nextShotAt = 0;
  private lastShotAt = -100;
  private lastShotPosition = new THREE.Vector3();
  private lastDamagedAt = -100;
  private combatGraceEndsAt = 0;
  private healingEndsAt = 0;
  private deployEndsAt = 0;
  private updateAccumulator = 0;
  private menuTime = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, callbacks: GameCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    const devicePixelRatio = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.camera.rotation.order = 'YXZ';
  }

  async initialize(): Promise<void> {
    await RAPIER.init({});
    this.physicsWorld = new RAPIER.World({ x: 0, y: -18, z: 0 });
    this.buildEnvironment();
    this.createPlayerPhysics();
    this.createWeapon();
    this.createObjectiveAndLoot();
    this.bindEvents();
    this.resize();
    this.camera.position.set(-42, 18, 51);
    this.camera.lookAt(-3, 2, -5);
    this.clock.start();
    this.animate();
  }

  captureControls(): void {
    this.audio.unlock();
    void this.canvas.requestPointerLock();
  }

  startRun(): void {
    this.audio.unlock();
    this.run = createRunState();
    this.run.phase = 'deploying';
    this.resetDynamicWorld();
    this.yaw = 0;
    this.pitch = 0;
    this.verticalVelocity = 0;
    this.cameraRecoil = 0;
    this.deployEndsAt = performance.now() / 1000 + 0.9;
    this.combatGraceEndsAt = performance.now() / 1000 + 3.4;
    this.callbacks.onDeploying(true);
    this.callbacks.onUpdate(this.run);
    void this.canvas.requestPointerLock();
  }

  resume(): void {
    if (this.run.phase !== 'paused') return;
    this.run.phase = this.run.extractionProgress > 0 ? 'extracting' : 'active';
    void this.canvas.requestPointerLock();
  }

  abortRun(): void {
    if (!['active', 'extracting', 'paused', 'deploying'].includes(this.run.phase)) return;
    this.failRun('行动已放弃');
  }

  debugGiveObjective(): void {
    this.takeObjective();
  }

  debugTeleportToObjective(): void {
    this.teleport(-18, -14);
  }

  debugTeleportToExtraction(): void {
    this.teleport(EXTRACTION_POINT.x, EXTRACTION_POINT.z);
  }

  debugDamage(amount = 20): void {
    this.damagePlayer(amount);
  }

  debugPreviewCorpseLoot(preferBoss = false): void {
    const enemy = preferBoss
      ? this.enemies.find((entry) => entry.boss && entry.alive)
      : this.enemies.find((entry) => !entry.boss && !entry.elite && entry.alive)
        ?? this.enemies.find((entry) => !entry.boss && entry.alive);
    if (!enemy) return;
    this.run.phase = 'active';
    this.callbacks.onDeploying(false);
    this.damageEnemy(enemy, enemy.maxHealth * 3, true);
    const entry = this.corpseLoot[this.corpseLoot.length - 1];
    if (!entry) return;
    this.teleport(entry.position.x, entry.position.z + 0.7);
    this.nearestInteraction = entry;
    this.startLootSearch(entry);
    if (!this.lootSearch) return;
    const now = performance.now() / 1000;
    this.lootSearch.startedAt = now - this.lootSearch.duration;
    this.updateLootSearch(now);
  }

  debugPreviewLocation(x: number, z: number, groundY = 0, yaw = 0): void {
    this.run.phase = 'active';
    this.callbacks.onDeploying(false);
    this.controlsActive = false;
    this.callbacks.onControlCapture(true);
    this.callbacks.onControlStatus('地图结构预览');
    this.playerBody.setTranslation({ x, y: groundY + 0.9, z }, true);
    this.playerBody.setNextKinematicTranslation({ x, y: groundY + 0.9, z });
    this.camera.position.set(x, groundY + 1.52, z);
    this.yaw = yaw;
    this.pitch = 0;
    this.camera.rotation.set(0, yaw, 0, 'YXZ');
    this.weapon.visible = true;
    this.callbacks.onUpdate(this.run);
    this.callbacks.onMiniMap(this.createMiniMapView());
    this.updateInteraction();
  }

  debugPreviewContainer(preferredTier: ContainerTier = 'safe'): void {
    const entry = this.loot.find((candidate) =>
      candidate.operationId === this.activeOperation.id && candidate.tier === preferredTier && !candidate.opened,
    ) ?? this.loot.find((candidate) => candidate.operationId === this.activeOperation.id && !candidate.opened);
    if (!entry) return;
    this.run.phase = 'active';
    this.callbacks.onDeploying(false);
    this.teleport(entry.position.x, entry.position.z + 0.7);
    this.nearestInteraction = entry;
    this.startLootSearch(entry);
  }

  debugPreviewImpactFeedback(): void {
    this.debugPreviewLocation(0, 62, 0, 0);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
    const normal = forward.clone().multiplyScalar(-1);
    const center = this.camera.position.clone().addScaledVector(forward, 4.2);
    const previews: Array<[ImpactSurface, number]> = [['metal', -1.35], ['wood', 0], ['dirt', 1.35]];
    for (const [surface, offset] of previews) {
      const point = center.clone().addScaledVector(right, offset);
      this.spawnSurfaceImpact(point, normal, forward, surface);
    }
    this.spawnArmorImpact(center.clone().add(new THREE.Vector3(0, 0.85, 0)), forward, true);
    this.callbacks.onHit('head');
  }

  discardBackpackItem(itemId: string): boolean {
    if (!['deploying', 'active', 'extracting', 'paused'].includes(this.run.phase)) return false;
    const item = this.run.backpack.find((entry) => entry.id === itemId);
    if (!item) return false;
    this.run.backpack = this.run.backpack.filter((entry) => entry.id !== itemId);
    this.callbacks.onUpdate(this.run);
    this.callbacks.onToast(`已丢弃 ${item.name}${item.quantity > 1 ? ` × ${item.quantity}` : ''}`);
    return true;
  }

  moveBackpackItem(sourceId: string, targetId: string | null): void {
    const reordered = reorderInventoryItems(this.run.backpack, sourceId, targetId);
    if (reordered === this.run.backpack) return;
    this.run.backpack = reordered;
    this.callbacks.onUpdate(this.run);
    this.refreshOpenLootView('背包顺序已调整');
  }

  sortBackpack(): void {
    this.run.backpack = sortInventoryItems(this.run.backpack);
    this.callbacks.onUpdate(this.run);
    this.refreshOpenLootView('已按稀有度和价值整理背包');
    this.callbacks.onToast('背包整理完成');
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private readonly resize = (): void => {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    if (event.code === 'KeyE') this.interact();
    if (event.code === 'KeyR') this.startReload();
    if (event.code === 'Digit4') this.useMedkit();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;
    if (!['active', 'extracting'].includes(this.run.phase)) return;
    const sensitivity = this.aiming ? 0.0011 : 0.0018;
    this.yaw -= event.movementX * sensitivity;
    this.pitch -= event.movementY * sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.42, 1.42);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;
    if (event.button === 0) this.firing = true;
    if (event.button === 2) this.aiming = true;
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) this.firing = false;
    if (event.button === 2) this.aiming = false;
  };

  private readonly onPointerLockChange = (): void => {
    if (
      document.pointerLockElement !== this.canvas &&
      (this.run.phase === 'active' || this.run.phase === 'extracting')
    ) {
      this.run.phase = 'paused';
      this.firing = false;
      this.aiming = false;
      this.callbacks.onPause();
      this.callbacks.onUpdate(this.run);
    }
  };

  private buildEnvironment(): void {
    this.scene.background = new THREE.Color('#9aafb0');
    this.scene.fog = new THREE.Fog('#9aafb0', 120, 330);

    const hemisphere = new THREE.HemisphereLight('#d7ded6', '#3f493c', 1.55);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight('#fff0ce', 3.2);
    sun.position.set(-35, 58, 28);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.left = -70;
    sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -70;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 140;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.025;
    this.scene.add(sun);

    const asphalt = new THREE.MeshStandardMaterial({
      color: '#4d524c',
      map: this.makeTexture('asphalt', '#5b6059', '#343a34'),
      roughness: 0.98,
      metalness: 0.02,
    });
    const concrete = new THREE.MeshStandardMaterial({
      color: '#aaa99f',
      map: this.makeTexture('concrete', '#b6b4a8', '#85867f'),
      roughness: 0.92,
    });
    const darkMetal = new THREE.MeshStandardMaterial({ color: '#3d4740', roughness: 0.64, metalness: 0.45 });
    const roofMetal = new THREE.MeshStandardMaterial({
      color: '#667068',
      map: this.makeTexture('metal', '#778078', '#3e4941'),
      roughness: 0.56,
      metalness: 0.52,
    });

    this.addBox(0, -0.55, 0, 120, 1, 100, asphalt, true);
    this.addBox(0, 1.6, -50.5, 121, 3.2, 1, concrete, true);
    this.addBox(-60.5, 1.6, 0, 1, 3.2, 101, concrete, true);
    this.addBox(60.5, 1.6, 0, 1, 3.2, 101, concrete, true);
    this.addBox(0, 1.6, 50.5, 121, 3.2, 1, concrete, true);

    const lineMaterial = new THREE.MeshBasicMaterial({ color: '#c6b956' });
    for (let z = -44; z <= 42; z += 12) {
      this.addBox(13, 0.015, z, 0.16, 0.025, 5, lineMaterial, false, false);
    }

    this.buildWarehouse(concrete, roofMetal, darkMetal);
    this.buildContainers();
    this.buildCheckpoint(concrete, darkMetal);
    this.buildCrane(darkMetal);
    this.addSetDressing(concrete, darkMetal);
    this.buildIslandBuildings(concrete, roofMetal, darkMetal);
    this.buildHarborDetails(concrete, darkMetal);
    this.buildDistantTerrain();
  }

  private buildWarehouse(
    concrete: THREE.Material,
    roofMetal: THREE.Material,
    darkMetal: THREE.Material,
  ): void {
    this.addBox(-18, 0.05, -10, 34, 0.1, 28, concrete, false);
    this.addBox(-18, 4, -24, 34, 8, 0.7, concrete, true);
    this.addBox(-35, 4, -10, 0.7, 8, 28, concrete, true);
    this.addBox(-1, 4, -10, 0.7, 8, 28, concrete, true);
    this.addBox(-29.5, 4, 4, 11, 8, 0.7, concrete, true);
    this.addBox(-6.5, 4, 4, 11, 8, 0.7, concrete, true);
    this.addBox(-18, 8.2, -10, 35, 0.45, 29, roofMetal, true);

    for (const x of [-31, -23, -13, -5]) {
      this.addBox(x, 1.25, -20, 3.4, 2.5, 2.2, darkMetal, true);
    }
    this.addBox(-18, 1.2, -2, 8, 2.4, 1.4, darkMetal, true);

    const lampMaterial = new THREE.MeshBasicMaterial({ color: '#d6e4bb' });
    for (const x of [-29, -18, -7]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.32), lampMaterial);
      lamp.position.set(x, 7.65, -10);
      this.scene.add(lamp);
      const light = new THREE.PointLight('#dce9c6', 8, 16, 2);
      light.position.set(x, 6.8, -10);
      this.scene.add(light);
    }
  }

  private buildIslandBuildings(
    concrete: THREE.Material,
    roofMetal: THREE.Material,
    darkMetal: THREE.Material,
  ): void {
    const windowMaterial = new THREE.MeshStandardMaterial({
      color: '#8fc2bf',
      emissive: '#274e4a',
      emissiveIntensity: 1.15,
      roughness: 0.2,
      metalness: 0.15,
    });
    this.buildBlockBuilding(11, -7, 18, 13, 7.5, concrete, roofMetal, windowMaterial);
    this.buildBlockBuilding(31, -12, 13, 16, 5.5, darkMetal, roofMetal, windowMaterial);
    this.buildBlockBuilding(-34, -29, 18, 13, 6, concrete, roofMetal, windowMaterial);
    this.buildBlockBuilding(-25, 28, 17, 12, 5.2, concrete, roofMetal, windowMaterial);

    const towerMaterial = new THREE.MeshStandardMaterial({ color: '#596961', roughness: 0.7, metalness: 0.42 });
    this.buildWatchTower(-45, 28, towerMaterial, windowMaterial);
    this.buildWatchTower(46, 27, towerMaterial, windowMaterial);
    this.buildWatchTower(46, -28, towerMaterial, windowMaterial);
  }

  private buildBlockBuilding(
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    body: THREE.Material,
    roof: THREE.Material,
    windows: THREE.Material,
  ): void {
    const wallThickness = 0.48;
    const doorWidth = Math.min(3.8, Math.max(2.8, Math.min(width, depth) * 0.22));
    const doorHeight = 2.85;
    const halfWidth = width / 2;
    const halfDepth = depth / 2;
    this.addBox(x, 0.04, z, width, 0.08, depth, body, false);

    const addWallZWithDoor = (wallZ: number): void => {
      const segmentWidth = (width - doorWidth) / 2;
      this.addBox(x - (doorWidth + segmentWidth) / 2, height / 2, wallZ, segmentWidth, height, wallThickness, body, true);
      this.addBox(x + (doorWidth + segmentWidth) / 2, height / 2, wallZ, segmentWidth, height, wallThickness, body, true);
      const lintelHeight = height - doorHeight;
      this.addBox(x, doorHeight + lintelHeight / 2, wallZ, doorWidth, lintelHeight, wallThickness, body, true);
    };
    const addWallXWithDoor = (wallX: number): void => {
      const segmentDepth = (depth - doorWidth) / 2;
      this.addBox(wallX, height / 2, z - (doorWidth + segmentDepth) / 2, wallThickness, height, segmentDepth, body, true);
      this.addBox(wallX, height / 2, z + (doorWidth + segmentDepth) / 2, wallThickness, height, segmentDepth, body, true);
      const lintelHeight = height - doorHeight;
      this.addBox(wallX, doorHeight + lintelHeight / 2, z, wallThickness, lintelHeight, doorWidth, body, true);
    };
    addWallZWithDoor(z - halfDepth);
    addWallZWithDoor(z + halfDepth);
    addWallXWithDoor(x - halfWidth);
    addWallXWithDoor(x + halfWidth);

    this.addBox(x, height + 0.16, z, width + 0.35, 0.32, depth + 0.35, roof, false);

    // A low interior divider creates two real rooms while retaining a wide central doorway.
    if (width >= 16 && depth >= 13) {
      const dividerHeight = Math.min(3.2, height - 0.5);
      const dividerDoor = 3.2;
      const segmentWidth = (width - dividerDoor - 2) / 2;
      if (segmentWidth > 1) {
        this.addBox(x - (dividerDoor + segmentWidth) / 2, dividerHeight / 2, z, segmentWidth, dividerHeight, 0.24, body, true);
        this.addBox(x + (dividerDoor + segmentWidth) / 2, dividerHeight / 2, z, segmentWidth, dividerHeight, 0.24, body, true);
        this.addBox(x, 3.02, z, dividerDoor, 0.36, 0.24, body, true);
      }
    }

    const windowWidth = Math.max(1.2, Math.min(2.6, width / 6));
    const count = Math.max(2, Math.floor(width / (windowWidth + 1.5)));
    for (let index = 0; index < count; index += 1) {
      const offset = (index - (count - 1) / 2) * (windowWidth + 1.2);
      if (Math.abs(offset) < doorWidth * 0.7) continue;
      this.addBox(x + offset, height * 0.58, z - depth / 2 - 0.015, windowWidth, 1.05, 0.06, windows, false, false);
      this.addBox(x + offset, height * 0.58, z + depth / 2 + 0.015, windowWidth, 1.05, 0.06, windows, false, false);
    }

    const threshold = new THREE.MeshBasicMaterial({ color: '#c7a83b' });
    this.addBox(x, 0.07, z - halfDepth, doorWidth, 0.04, 0.5, threshold, false, false);
    this.addBox(x, 0.07, z + halfDepth, doorWidth, 0.04, 0.5, threshold, false, false);
    this.addBox(x - halfWidth, 0.07, z, 0.5, 0.04, doorWidth, threshold, false, false);
    this.addBox(x + halfWidth, 0.07, z, 0.5, 0.04, doorWidth, threshold, false, false);

    const interiorLight = new THREE.MeshBasicMaterial({ color: '#d9eadb' });
    for (const offset of [-depth * 0.23, depth * 0.23]) {
      this.addBox(x, Math.min(height - 0.25, 3.5), z + offset, Math.min(4.5, width * 0.35), 0.08, 0.3, interiorLight, false, false);
    }
  }

  private buildWatchTower(x: number, z: number, metal: THREE.Material, windows: THREE.Material): void {
    for (const dx of [-1.5, 1.5]) {
      for (const dz of [-1.5, 1.5]) this.addBox(x + dx, 2.5, z + dz, 0.28, 5, 0.28, metal, true);
    }
    this.addBox(x, 5.15, z, 4.5, 0.3, 4.5, metal, true);
    this.addBox(x, 6.4, z, 3.8, 2.2, 3.8, windows, true, false);
    this.addBox(x, 7.65, z, 4.2, 0.25, 4.2, metal, false);
    this.addBox(x, 9.2, z, 0.18, 2.8, 0.18, metal, false);
  }

  private buildContainers(): void {
    const geometry = new THREE.BoxGeometry(6, 2.6, 2.5);
    const containerTexture = this.makeTexture('metal', '#aeb6ad', '#4f5952');
    containerTexture.repeat.set(4, 2);
    const materials = [
      new THREE.MeshStandardMaterial({ color: '#566b64', map: containerTexture, roughness: 0.7, metalness: 0.42 }),
      new THREE.MeshStandardMaterial({ color: '#805c46', map: containerTexture, roughness: 0.74, metalness: 0.34 }),
      new THREE.MeshStandardMaterial({ color: '#656959', map: containerTexture, roughness: 0.76, metalness: 0.36 }),
    ];
    const placements = [
      [24, 1.3, 29, 0], [30.5, 1.3, 29, 0], [37, 1.3, 29, 0],
      [30, 1.3, 20, Math.PI / 2], [30, 4, 20, Math.PI / 2],
      [7, 1.3, 10, 0], [13.5, 1.3, 10, 0], [20, 1.3, 10, 0],
      [5, 1.3, -25, Math.PI / 2], [5, 4, -25, Math.PI / 2],
      [18, 1.3, -34, 0], [24.5, 1.3, -34, 0],
      [-44, 1.3, 16, Math.PI / 2], [-44, 1.3, 23, Math.PI / 2],
    ] as const;
    const meshes = materials.map((material) => {
      const mesh = new THREE.InstancedMesh(geometry, material, Math.ceil(placements.length / materials.length));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      this.scene.add(mesh);
      this.blockers.push(mesh);
      return mesh;
    });
    const counts = [0, 0, 0];
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    placements.forEach(([x, y, z, rotation], index) => {
      const materialIndex = index % materials.length;
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
      matrix.compose(new THREE.Vector3(x, y, z), quaternion, scale);
      meshes[materialIndex].setMatrixAt(counts[materialIndex], matrix);
      counts[materialIndex] += 1;
      meshes[materialIndex].count = counts[materialIndex];
      const swapped = Math.abs(rotation) > 0.1;
      this.addStaticCollider(x, y, z, swapped ? 2.5 : 6, 2.6, swapped ? 6 : 2.5);
    });
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  }

  private buildCheckpoint(concrete: THREE.Material, metal: THREE.Material): void {
    this.addBox(43, 1.1, 4, 6.2, 2.2, 4.8, concrete, true);
    this.addBox(43, 2.55, 4, 6.6, 0.25, 5.2, metal, true);
    this.addBox(38.5, 0.5, 0, 5, 1, 0.5, concrete, true);
    this.addBox(48.5, 0.5, 0, 5, 1, 0.5, concrete, true);
    this.addBox(43.5, 0.5, 0, 3.5, 1, 0.5, concrete, true);
  }

  private buildCrane(metal: THREE.Material): void {
    this.addBox(-47, 7, -32, 1.2, 14, 1.2, metal, true);
    this.addBox(-47, 13.5, -20, 1, 1, 24, metal, false);
    this.addBox(-47, 7, -9, 1.2, 14, 1.2, metal, true);
    this.addBox(-47, 10, -20, 0.4, 0.4, 23, metal, false);
  }

  private buildHarborDetails(concrete: THREE.Material, metal: THREE.Material): void {
    const road = new THREE.MeshBasicMaterial({ color: '#c6b956' });
    for (const [x, z, width, depth] of [
      [11, -34, 0.22, 14], [11, 24, 0.22, 14], [29, 6, 14, 0.22], [39, 20, 8, 0.22],
    ] as const) {
      this.addBox(x, 0.015, z, width, 0.025, depth, road, false, false);
    }

    const pad = new THREE.MeshBasicMaterial({ color: '#d8d4ad', side: THREE.DoubleSide });
    const helipad = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 0.05, 48), pad);
    helipad.position.set(34, 0.03, 30);
    this.scene.add(helipad);
    const helipadRing = new THREE.Mesh(
      new THREE.TorusGeometry(5.5, 0.13, 8, 48),
      new THREE.MeshBasicMaterial({ color: '#c06442', transparent: true, opacity: 0.9 }),
    );
    helipadRing.position.set(34, 0.08, 30);
    helipadRing.rotation.x = Math.PI / 2;
    this.scene.add(helipadRing);
    this.addBox(34, 0.08, 30, 0.5, 0.04, 3.8, road, false, false);
    this.addBox(34, 0.08, 30, 3.8, 0.04, 0.5, road, false, false);

    const tankMaterial = new THREE.MeshStandardMaterial({ color: '#bdc4ad', roughness: 0.48, metalness: 0.55 });
    for (const [x, z] of [[33, -31], [39, -31], [45, -31]] as const) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 3.2, 18), tankMaterial);
      tank.position.set(x, 1.6, z);
      tank.castShadow = true;
      tank.receiveShadow = true;
      this.scene.add(tank);
      this.addBox(x, 3.35, z, 0.22, 0.7, 0.22, metal, false);
    }

    const bollard = new THREE.MeshStandardMaterial({ color: '#4b514a', roughness: 0.8, metalness: 0.3 });
    for (let index = 0; index < 7; index += 1) {
      const z = -44 - index * 2.8;
      this.addBox(37.5, 0.46, z, 0.5, 0.9, 0.5, bollard, false);
      this.addBox(50.5, 0.46, z, 0.5, 0.9, 0.5, bollard, false);
    }
    this.addBox(44, 1.2, -59, 0.2, 2.4, 13, metal, false);
    this.addBox(44, 2.35, -59, 0.2, 0.2, 13, metal, false);
  }

  private addSetDressing(concrete: THREE.Material, metal: THREE.Material): void {
    for (const [x, z] of [[-47, 5], [-47, -2], [52, 22], [52, 14]]) {
      this.addBox(x, 1.25, z, 2.4, 2.5, 2.4, concrete, true);
    }
    this.addBox(16, 1.6, 40, 13, 3.2, 0.6, metal, true);
  }

  private buildDistantTerrain(): void {
    const terrainMaterial = new THREE.MeshStandardMaterial({ color: '#52665f', roughness: 1 });
    const foothillMaterial = new THREE.MeshStandardMaterial({ color: '#71847a', roughness: 1 });
    const placements: Array<[number, number, number, number, THREE.Material]> = [
      [-112, 9, -20, 30, terrainMaterial], [-92, 12, 42, 38, foothillMaterial],
      [-26, 11, 118, 34, terrainMaterial], [32, 10, 116, 30, foothillMaterial],
      [104, 14, 52, 42, terrainMaterial], [108, 12, -42, 36, foothillMaterial],
      [-100, 12, -88, 40, foothillMaterial], [12, 13, -112, 42, terrainMaterial],
    ];
    for (const [x, height, z, radius, material] of placements) {
      const hill = new THREE.Mesh(new THREE.ConeGeometry(radius, height * 2.8, 10), material);
      hill.position.set(x, height * 1.25 - 0.8, z);
      hill.scale.set(1.6, 1, 0.78);
      hill.receiveShadow = true;
      this.scene.add(hill);
    }
  }

  private addBox(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    material: THREE.Material,
    collide: boolean,
    castShadow = true,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    if (collide) {
      this.blockers.push(mesh);
      this.addStaticCollider(x, y, z, width, height, depth);
    }
    return mesh;
  }

  private addStaticCollider(x: number, y: number, z: number, width: number, height: number, depth: number): void {
    const body = this.physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    this.physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2), body);
  }

  private makeTexture(kind: 'asphalt' | 'concrete' | 'metal', base: string, accent: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    context.fillStyle = base;
    context.fillRect(0, 0, 512, 512);
    const random = new SeededRandom(kind.length * 913);
    for (let index = 0; index < 6200; index += 1) {
      const alpha = 0.025 + random.next() * 0.1;
      context.fillStyle = `${accent}${Math.floor(alpha * 255).toString(16).padStart(2, '0')}`;
      const size = 1 + random.next() * 4;
      context.fillRect(random.next() * 512, random.next() * 512, size, size);
    }
    context.globalAlpha = 0.22;
    context.strokeStyle = accent;
    if (kind === 'concrete') {
      context.beginPath();
      context.moveTo(0, 264);
      context.bezierCurveTo(124, 238, 300, 290, 512, 252);
      context.stroke();
    } else if (kind === 'metal') {
      for (let x = 0; x < 512; x += 32) {
        context.fillRect(x, 0, 2, 512);
      }
    }
    context.globalAlpha = 1;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(kind === 'asphalt' ? 18 : 3, kind === 'asphalt' ? 15 : 3);
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  private createPlayerPhysics(): void {
    this.playerBody = this.physicsWorld.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(SPAWN_POINT.x, 0.9, SPAWN_POINT.z),
    );
    this.playerCollider = this.physicsWorld.createCollider(
      RAPIER.ColliderDesc.capsule(0.5, 0.35),
      this.playerBody,
    );
    this.characterController = this.physicsWorld.createCharacterController(0.04);
    this.characterController.enableAutostep(0.42, 0.18, true);
    this.characterController.enableSnapToGround(0.22);
    this.characterController.setApplyImpulsesToDynamicBodies(true);
  }

  private createWeapon(): void {
    this.weapon = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#252b27', roughness: 0.45, metalness: 0.6 });
    const gripMaterial = new THREE.MeshStandardMaterial({ color: '#181b18', roughness: 0.9 });
    this.weaponReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.62), bodyMaterial);
    this.weaponReceiver.position.set(0, -0.03, -0.22);
    this.weaponBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.54, 10), bodyMaterial);
    this.weaponBarrel.rotation.x = Math.PI / 2;
    this.weaponBarrel.position.set(0, 0.01, -0.73);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.12), gripMaterial);
    grip.rotation.x = -0.2;
    grip.position.set(0, -0.16, -0.18);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.12), bodyMaterial);
    sight.position.set(0, 0.12, -0.31);
    const handguard = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.4, 10), bodyMaterial);
    handguard.rotation.x = Math.PI / 2;
    handguard.position.set(0, 0, -0.52);
    const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.024, 0.5), gripMaterial);
    topRail.position.set(0, 0.095, -0.36);
    const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.27, 0.16), gripMaterial);
    magazine.position.set(0, -0.18, -0.05);
    magazine.rotation.x = -0.16;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.17, 0.32), gripMaterial);
    stock.position.set(0, -0.015, 0.23);
    stock.rotation.x = -0.05;
    const muzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.035, 0.15, 10), bodyMaterial);
    muzzleBrake.rotation.x = Math.PI / 2;
    muzzleBrake.position.set(0, 0.01, -1.04);
    const scopeRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.09, 0.012, 8, 18),
      new THREE.MeshStandardMaterial({ color: '#1b211d', roughness: 0.35, metalness: 0.78 }),
    );
    scopeRing.position.set(0, 0.12, -0.5);
    scopeRing.rotation.x = Math.PI / 2;
    const scopeLens = new THREE.Mesh(
      new THREE.CircleGeometry(0.077, 24),
      new THREE.MeshPhysicalMaterial({
        color: '#bfe4d5',
        transparent: true,
        opacity: 0.13,
        roughness: 0.08,
        metalness: 0,
        transmission: 0.12,
        depthWrite: false,
      }),
    );
    scopeLens.position.set(0, 0.12, -0.503);
    scopeLens.rotation.y = Math.PI;
    const sleeveMaterial = new THREE.MeshStandardMaterial({ color: '#657663', roughness: 0.9 });
    const gloveMaterial = new THREE.MeshStandardMaterial({ color: '#1e2721', roughness: 0.86 });
    this.leftPlayerArm = this.makePlayerArm(sleeveMaterial, gloveMaterial, -1);
    this.rightPlayerArm = this.makePlayerArm(sleeveMaterial, gloveMaterial, 1);
    this.leftPlayerArm.position.set(-0.24, -0.22, -0.36);
    this.rightPlayerArm.position.set(0.25, -0.2, -0.18);
    this.weapon.add(
      this.weaponReceiver, this.weaponBarrel, handguard, topRail, magazine, stock, muzzleBrake,
      grip, sight, scopeRing, scopeLens, this.leftPlayerArm, this.rightPlayerArm,
    );
    this.weapon.position.set(0.27, -0.25, -0.52);
    this.camera.add(this.weapon);
    this.scene.add(this.camera);

    const flashlightTarget = new THREE.Object3D();
    flashlightTarget.position.set(0, -0.08, -14);
    this.flashlight = new THREE.SpotLight('#e8f2dd', 0, 42, Math.PI / 7.5, 0.34, 1.35);
    this.flashlight.position.set(0.16, -0.08, -0.18);
    this.flashlight.target = flashlightTarget;
    this.camera.add(this.flashlight, flashlightTarget);

    this.carriedCargo = this.makeSupplyCase('#535c50', '#d3e468');
    this.carriedCargo.position.set(0, -0.44, -0.82);
    this.carriedCargo.rotation.set(-0.16, 0.08, 0);
    this.carriedCargo.scale.setScalar(0.52);
    this.carriedCargo.visible = false;
    this.camera.add(this.carriedCargo);

    this.muzzleFlash = new THREE.Group();
    const flashMaterial = new THREE.MeshBasicMaterial({ color: '#fff0a8', transparent: true, opacity: 0.96, blending: THREE.AdditiveBlending, depthWrite: false });
    const flashCore = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 8), flashMaterial);
    const flashPlume = new THREE.Mesh(new THREE.ConeGeometry(0.105, 0.34, 7), flashMaterial.clone());
    flashPlume.rotation.x = -Math.PI / 2;
    flashPlume.position.z = -0.17;
    const flashCross = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.25, 5), flashMaterial.clone());
    flashCross.rotation.x = -Math.PI / 2;
    flashCross.rotation.z = Math.PI / 4;
    flashCross.position.z = -0.1;
    this.muzzleFlash.add(flashCore, flashPlume, flashCross);
    this.muzzleFlashLight = new THREE.PointLight('#ffb24f', 0, 5.5, 2.1);
    this.muzzleFlashLight.position.z = -0.08;
    this.muzzleFlash.add(this.muzzleFlashLight);
    this.muzzleFlash.position.set(0, 0.01, -1.03);
    this.muzzleFlash.visible = false;
    this.weapon.add(this.muzzleFlash);
    this.createWeaponEffectPools();
    this.applyWeaponVisual();
  }

  private createWeaponEffectPools(): void {
    const shellGeometry = new THREE.CylinderGeometry(0.012, 0.012, 0.048, 7);
    const shellMaterial = new THREE.MeshStandardMaterial({ color: '#c6a04a', roughness: 0.32, metalness: 0.88 });
    for (let index = 0; index < 32; index += 1) {
      const mesh = new THREE.Mesh(shellGeometry, shellMaterial);
      mesh.visible = false;
      this.scene.add(mesh);
      this.shells.push({ mesh, velocity: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
    }
    const bloodGeometry = new THREE.SphereGeometry(0.08, 6, 5);
    const bloodMaterial = new THREE.MeshBasicMaterial({ color: '#8e1717', transparent: true, opacity: 0.62, depthWrite: false });
    for (let index = 0; index < 72; index += 1) {
      const mesh = new THREE.Mesh(bloodGeometry, bloodMaterial);
      mesh.visible = false;
      this.scene.add(mesh);
      this.bloodParticles.push({ mesh, velocity: new THREE.Vector3(), life: 0, maxLife: 0.35 });
    }
  }

  private makePlayerArm(sleeveMaterial: THREE.Material, gloveMaterial: THREE.Material, side: number): THREE.Group {
    const arm = new THREE.Group();
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.22, 4, 8), sleeveMaterial);
    sleeve.position.y = -0.12;
    sleeve.rotation.z = side * 0.25;
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 7), gloveMaterial);
    glove.position.y = 0.1;
    arm.add(sleeve, glove);
    arm.rotation.x = -0.76;
    return arm;
  }

  private applyWeaponVisual(): void {
    if (!this.weaponReceiver || !this.weaponBarrel) return;
    const config = WEAPON_CONFIGS[this.activeWeaponId];
    const material = this.weaponReceiver.material;
    material.color.set(config.color);
    this.weaponBarrel.material.color.set(config.color);
    this.weaponReceiver.scale.z = config.receiverScale;
    this.weaponBarrel.scale.y = config.barrelScale;
    this.weaponBarrel.position.z = config.muzzleZ + 0.3;
    this.muzzleFlash.position.z = config.muzzleZ;
  }

  private createObjectiveAndLoot(): void {
    this.objectiveCase = this.makeSupplyCase('#262b27', '#d3e468');
    this.objectiveCase.position.set(this.activeOperation.objective.x, 0.42, this.activeOperation.objective.z);
    this.scene.add(this.objectiveCase);

    this.extractionMarker = new THREE.Mesh(
      new THREE.CylinderGeometry(6.8, 6.8, 0.06, 64),
      new THREE.MeshBasicMaterial({
        color: '#bbff4e',
        transparent: true,
        opacity: 0.46,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.extractionMarker.position.set(this.activeOperation.extraction.x, 0.035, this.activeOperation.extraction.z);

    this.extractionBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 5.8, 34, 48, 1, true),
      new THREE.MeshBasicMaterial({
        color: '#aaff5c',
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.extractionBeam.position.set(this.activeOperation.extraction.x, 17, this.activeOperation.extraction.z);

    this.extractionRing = new THREE.Mesh(
      new THREE.TorusGeometry(6.9, 0.13, 10, 96),
      new THREE.MeshBasicMaterial({ color: '#d8ff86', transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.extractionRing.position.set(this.activeOperation.extraction.x, 0.12, this.activeOperation.extraction.z);
    this.extractionRing.rotation.x = Math.PI / 2;

    this.extractionLabel = this.makeExtractionLabel();
    this.extractionLabel.position.set(this.activeOperation.extraction.x, 7.2, this.activeOperation.extraction.z);

    this.extractionBeacon = new THREE.Group();
    const beaconMetal = new THREE.MeshStandardMaterial({ color: '#33463e', roughness: 0.52, metalness: 0.66 });
    const beaconGlow = new THREE.MeshBasicMaterial({ color: '#caff71' });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 5.4, 10), beaconMetal);
    mast.position.y = 2.7;
    const topLight = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), beaconGlow);
    topLight.position.y = 5.35;
    const sideLight = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 7), beaconGlow);
    sideLight.position.set(0.48, 3.8, 0);
    this.extractionBeacon.add(mast, topLight, sideLight);
    this.extractionBeacon.position.set(this.activeOperation.extraction.x, 0, this.activeOperation.extraction.z);

    this.extractionLight = new THREE.PointLight('#baff6a', 9, 32, 1.7);
    this.extractionLight.position.set(this.activeOperation.extraction.x, 4.8, this.activeOperation.extraction.z);

    const smokePositions = new Float32Array(22 * 3);
    const smokeGeometry = new THREE.BufferGeometry();
    smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
    this.extractionSmoke = new THREE.Points(
      smokeGeometry,
      new THREE.PointsMaterial({ color: '#dce7da', size: 2.6, transparent: true, opacity: 0.24, depthWrite: false }),
    );
    this.extractionSmoke.position.set(this.activeOperation.extraction.x, 0.4, this.activeOperation.extraction.z);
    this.scene.add(
      this.extractionMarker,
      this.extractionBeam,
      this.extractionRing,
      this.extractionLabel,
      this.extractionBeacon,
      this.extractionLight,
      this.extractionSmoke,
    );

    const random = new SeededRandom(1709);
    for (const operation of Object.values(OPERATIONS)) {
      operation.loot.forEach(([x, z, tier], index) => {
        const rule = CONTAINER_RULES[tier];
        const mesh = this.makeSupplyCase(tier === 'safe' ? '#292d2b' : '#454c43', tier === 'safe' ? '#a88b48' : '#7e9674');
        mesh.scale.setScalar(rule.scale);
        mesh.position.set(x, 0.32 * rule.scale, z);
        mesh.rotation.y = random.next() * Math.PI;
        mesh.visible = operation.id === this.activeOperation.id;
        this.scene.add(mesh);
        this.loot.push({
          mesh,
          position: new THREE.Vector3(x, 0.32, z),
          operationId: operation.id,
          tier,
          containerName: rule.name,
          items: this.rollContainerLoot(tier, new SeededRandom(1709 + index * 71 + operation.id.length * 997)),
          opened: false,
        });
      });
    }
  }

  private rollContainerLoot(tier: ContainerTier, random: SeededRandom): InventoryItem[] {
    const rule = CONTAINER_RULES[tier];
    const count = rule.min + Math.floor(random.next() * (rule.max - rule.min + 1));
    const results: InventoryItem[] = [];
    for (let index = 0; index < count; index += 1) {
      const total = rule.weights.reduce((sum, weight) => sum + weight, 0);
      let roll = random.next() * total;
      let rarity = RARITY_ORDER[0];
      for (let rarityIndex = 0; rarityIndex < rule.weights.length; rarityIndex += 1) {
        roll -= rule.weights[rarityIndex];
        if (roll <= 0) {
          rarity = RARITY_ORDER[rarityIndex];
          break;
        }
      }
      const pool = LOOT_TABLE.filter((item) => item.rarity === rarity);
      const source = random.pick(pool);
      const quantity = ['black', 'white', 'green'].includes(source.rarity) && random.next() > 0.55 ? 2 : 1;
      results.push({ ...source, quantity });
    }
    return results;
  }

  private makeSupplyCase(bodyColor: string, trimColor: string): THREE.Group {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.74, metalness: 0.26 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: trimColor, roughness: 0.62, metalness: 0.32 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.34, 0.72), bodyMaterial);
    body.position.y = -0.05;
    body.castShadow = true;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.17, 0.13, 0.74), bodyMaterial);
    lid.position.y = 0.2;
    lid.castShadow = true;
    const trimA = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.39, 0.76), trimMaterial);
    trimA.position.y = -0.03;
    trimA.position.x = -0.39;
    const trimB = trimA.clone();
    trimB.position.x = 0.39;
    group.add(body, lid, trimA, trimB);
    group.userData.lid = lid;
    return group;
  }

  private makeExtractionLabel(): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    context.fillStyle = 'rgba(9, 18, 10, 0.8)';
    context.fillRect(3, 3, 506, 122);
    context.strokeStyle = '#cfff6a';
    context.lineWidth = 6;
    context.strokeRect(3, 3, 506, 122);
    context.fillStyle = '#efffd0';
    context.font = '700 52px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('撤 离 点', 256, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(7.8, 1.95, 1);
    sprite.renderOrder = 20;
    return sprite;
  }

  private resetDynamicWorld(): void {
    for (const enemy of this.enemies) this.scene.remove(enemy.group);
    for (const tracer of this.tracers) this.scene.remove(tracer.line);
    this.enemies.length = 0;
    this.enemyHitMeshes.length = 0;
    this.tracers.length = 0;
    this.entityManager = new YUKA.EntityManager();
    const taskUsesObjective = ['rescue', 'plant-bomb', 'escort'].includes(this.operationScenario.task.type);
    this.objectiveCase.visible = this.activeGameMode === 'extraction' || taskUsesObjective;
    this.lastDamagedAt = -100;
    this.lastShotAt = -100;
    this.lastPlayerNoiseAt = -100;
    this.lastPlayerNoisePosition.set(0, 0, 0);
    this.lastPlayerNoiseRadius = 0;
    this.nextShotAt = 0;
    this.healingEndsAt = 0;
    this.firing = false;
    this.setAiming(false);
    this.cancelLootSearch();
    this.loot.forEach((entry) => {
      entry.opened = false;
      entry.mesh.visible = entry.operationId === this.activeOperation.id;
      const lid = entry.mesh.userData.lid as THREE.Mesh | undefined;
      if (lid) {
        lid.position.set(0, 0.2, 0);
        lid.rotation.set(0, 0, 0);
      }
    });
    this.objectiveCase.position.set(this.activeOperation.objective.x, 0.42, this.activeOperation.objective.z);
    this.extractionMarker.position.set(this.activeOperation.extraction.x, 0.035, this.activeOperation.extraction.z);
    this.extractionBeam.position.set(this.activeOperation.extraction.x, 7.5, this.activeOperation.extraction.z);
    this.extractionRing.position.set(this.activeOperation.extraction.x, 0.12, this.activeOperation.extraction.z);
    this.extractionLabel.position.set(this.activeOperation.extraction.x, 5.1, this.activeOperation.extraction.z);
    this.createEnemies();
    this.teleport(this.activeOperation.spawn.x, this.activeOperation.spawn.z);
    this.callbacks.onPrompt(null);
  }

  private createEnemies(): void {
    const random = new SeededRandom(91173);
    const difficulty = DIFFICULTIES[this.activeDifficulty];
    const enemyPositions = this.activeOperation.enemies.slice(0, Math.max(4, Math.ceil(this.activeOperation.enemies.length * difficulty.enemyCount)));
    enemyPositions.forEach(([x, z], index) => {
      const group = new THREE.Group();
      const uniform = new THREE.MeshStandardMaterial({ color: index % 2 ? '#505b4f' : '#5b5547', roughness: 0.86 });
      const vest = new THREE.MeshStandardMaterial({ color: '#252b26', roughness: 0.8 });
      const skin = new THREE.MeshStandardMaterial({ color: '#9c806d', roughness: 0.9 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.38), uniform);
      body.position.y = 1.1;
      body.castShadow = true;
      const armor = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.32), vest);
      armor.position.set(0, 1.2, 0.07);
      armor.castShadow = true;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), skin);
      head.position.y = 1.82;
      head.castShadow = true;
      const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.82, 0.2), uniform);
      const rightArm = leftArm.clone();
      leftArm.position.set(-0.46, 1.08, 0);
      rightArm.position.set(0.46, 1.08, 0);
      leftArm.castShadow = true;
      rightArm.castShadow = true;
      const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.78, 0.24), uniform);
      const rightLeg = leftLeg.clone();
      leftLeg.position.set(-0.19, 0.34, 0);
      rightLeg.position.set(0.19, 0.34, 0);
      leftLeg.castShadow = true;
      rightLeg.castShadow = true;
      const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.8), vest);
      weapon.position.set(0.32, 1.12, 0.22);
      weapon.rotation.x = -0.12;
      group.add(body, armor, head, leftArm, rightArm, leftLeg, rightLeg, weapon);
      group.position.set(x, 0, z);
      this.scene.add(group);

      const vehicle = new YUKA.Vehicle();
      vehicle.position.set(x, 0, z);
      vehicle.maxSpeed = 1.25 + random.next() * 0.25;
      vehicle.maxForce = 5;
      const path = new YUKA.Path();
      path.loop = true;
      path.add(new YUKA.Vector3(x, 0, z));
      path.add(new YUKA.Vector3(x + (random.next() - 0.5) * 12, 0, z + (random.next() - 0.5) * 12));
      path.add(new YUKA.Vector3(x + (random.next() - 0.5) * 12, 0, z + (random.next() - 0.5) * 12));
      vehicle.steering.add(new YUKA.FollowPathBehavior(path, 0.7));
      const seek = new YUKA.SeekBehavior(new YUKA.Vector3(x, 0, z));
      const runtime: EnemyRuntime = {
        group,
        body,
        head,
        leftArm,
        rightArm,
        leftLeg,
        rightLeg,
        vehicle,
        path,
        seek,
        state: 'patrol',
        health: Math.round(82 * difficulty.health),
        home: new THREE.Vector3(x, 0, z),
        facing: new THREE.Vector3(0, 0, 1),
        lastSeen: new THREE.Vector3(x, 0, z),
        lastStateChange: 0,
        fireCooldown: 0.5 + random.next(),
        burstRemaining: 0,
        alive: true,
      };
      body.userData.enemy = runtime;
      body.userData.hitZone = 'body';
      armor.userData.enemy = runtime;
      armor.userData.hitZone = 'body';
      head.userData.enemy = runtime;
      head.userData.hitZone = 'head';
      this.enemyHitMeshes.push(body, armor, head);
      this.enemies.push(runtime);
      this.entityManager.add(vehicle);
    });
  }

  private animate = (): void => {
    if (this.disposed) return;
    requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const now = performance.now() / 1000;
    if (this.run.phase === 'menu') {
      this.updateMenuCamera(delta);
    } else if (this.run.phase === 'deploying') {
      if (now >= this.deployEndsAt) {
        this.run.phase = 'active';
        this.callbacks.onDeploying(false);
      }
      this.updatePlayer(delta);
    } else if (this.run.phase === 'active' || this.run.phase === 'extracting') {
      this.updateRun(delta, now);
    }
    this.updateWeaponVisual(delta, now);
    this.updateTracers(delta);
    const extractionPulse = 0.5 + Math.sin(now * 3.2) * 0.16;
    this.extractionMarker.material.opacity = extractionPulse;
    this.extractionBeam.material.opacity = 0.13 + Math.sin(now * 2.1) * 0.045;
    this.extractionRing.rotation.z = now * 0.42;
    this.extractionRing.scale.setScalar(1 + Math.sin(now * 3.2) * 0.035);
    this.extractionLabel.position.y = 5.1 + Math.sin(now * 1.8) * 0.16;
    this.water.position.y = -1.16 + Math.sin(now * 0.8) * 0.025;
    this.renderer.render(this.scene, this.camera);
  };

  private updateMenuCamera(delta: number): void {
    this.menuTime += delta * 0.08;
    const angle = this.menuTime + 0.5;
    this.camera.position.set(Math.cos(angle) * 58, 18, Math.sin(angle) * 58);
    this.camera.lookAt(-5, 2.2, -4);
  }

  private updateRun(delta: number, now: number): void {
    this.run.elapsedSeconds += delta;
    if (this.run.elapsedSeconds >= 1200) {
      this.failRun('撤离窗口关闭');
      return;
    }
    this.updatePlayer(delta);
    this.updateWeapon(delta, now);
    this.updateEnemies(delta, now);
    this.updateInteraction();
    this.updateLootSearch(now);
    this.updateExtraction(delta, now);
    this.completeHealing(now);
    this.updateAccumulator += delta;
    if (this.updateAccumulator >= 0.05) {
      this.updateAccumulator = 0;
      this.callbacks.onUpdate(this.run);
      this.callbacks.onCompass(this.formatHeading());
    }
  }

  private updatePlayer(delta: number): void {
    const crouching = this.keys.has('KeyC');
    const sprinting = this.keys.has('ShiftLeft') && !crouching && this.run.player.stamina > 1;
    const forwardAmount = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
    const rightAmount = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
    const moving = Math.abs(forwardAmount) + Math.abs(rightAmount) > 0;
    let speed = crouching ? 2.15 : sprinting ? 6.1 : 3.65;
    if (this.aiming) speed *= 0.68;

    if (sprinting && moving) this.run.player.stamina = Math.max(0, this.run.player.stamina - delta * 22);
    else this.run.player.stamina = Math.min(100, this.run.player.stamina + delta * 14);

    // Movement always follows the current mouse-controlled camera direction.
    const forward = this.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const movement = forward.multiplyScalar(forwardAmount).add(right.multiplyScalar(rightAmount));
    if (movement.lengthSq() > 1) movement.normalize();
    movement.multiplyScalar(speed * delta);

    const grounded = this.characterController.computedGrounded();
    if (grounded && this.verticalVelocity < 0) this.verticalVelocity = -0.5;
    if (grounded && this.keys.has('Space') && !crouching) this.verticalVelocity = 6.1;
    this.verticalVelocity -= 18 * delta;

    this.characterController.computeColliderMovement(this.playerCollider, {
      x: movement.x,
      y: this.verticalVelocity * delta,
      z: movement.z,
    });
    const corrected = this.characterController.computedMovement();
    const translation = this.playerBody.translation();
    this.playerBody.setNextKinematicTranslation({
      x: translation.x + corrected.x,
      y: translation.y + corrected.y,
      z: translation.z + corrected.z,
    });
    this.physicsWorld.timestep = delta;
    this.physicsWorld.step();
    const next = this.playerBody.translation();
    if (next.y < FALL_RECOVERY_Y) {
      this.verticalVelocity = 0;
      this.teleport(this.activeOperation.spawn.x, this.activeOperation.spawn.z);
      this.callbacks.onToast('已返回安全区域', 'danger');
      return;
    }
    this.cameraHeight = THREE.MathUtils.lerp(this.cameraHeight, crouching ? 0.22 : 0.62, 1 - Math.pow(0.001, delta));
    this.camera.position.set(next.x, next.y + this.cameraHeight, next.z);
    this.cameraRecoil = THREE.MathUtils.lerp(this.cameraRecoil, 0, 1 - Math.pow(0.00005, delta));
    this.camera.rotation.set(this.pitch + this.cameraRecoil, this.yaw, 0, 'YXZ');
  }

  private updateWeapon(_delta: number, now: number): void {
    const weapon = this.run.player.weapon;
    const config = WEAPON_CONFIGS[this.activeWeaponId];
    if (weapon.reloading && now >= weapon.reloadEndsAt) {
      const reloaded = completeReload(weapon, config.magazineSize);
      this.run.player.weapon = reloaded;
      this.weaponStates.set(this.activeWeaponId, reloaded);
      this.audio.tone(510, 0.06, 0.04);
    }
    if (this.firing && !weapon.reloading && now >= this.nextShotAt) this.fireWeapon(now);
  }

  private fireWeapon(now: number): void {
    if (this.lootSearch) this.cancelLootSearch('搜索被射击动作中断');
    const weapon = this.run.player.weapon;
    const config = WEAPON_CONFIGS[this.activeWeaponId];
    if (weapon.magazine <= 0) {
      this.nextShotAt = now + 0.2;
      this.audio.tone(120, 0.05, 0.05);
      return;
    }
    weapon.magazine -= 1;
    this.nextShotAt = now + config.fireInterval;
    this.lastShotAt = now;
    this.lastShotPosition.copy(this.camera.position);
    this.cameraRecoil = Math.min(0.045, this.cameraRecoil + (this.aiming ? config.recoil * 0.45 : config.recoil));
    this.yaw += (Math.random() - 0.5) * (this.aiming ? config.recoil * 0.08 : config.recoil * 0.18);
    this.audio.shot(config.id === 'shotgun' ? 0.24 : 0.18);
    this.muzzleFlash.visible = true;
    window.setTimeout(() => { this.muzzleFlash.visible = false; }, 42);

    const spread = this.aiming ? config.aimSpread : config.hipSpread;
    for (let pellet = 0; pellet < config.pellets; pellet += 1) {
      const direction = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(this.camera.quaternion)
        .add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, 0))
        .normalize();
      this.raycaster.set(this.camera.position, direction);
      this.raycaster.far = 120;
      const intersections = this.raycaster.intersectObjects([...this.blockers, ...this.enemyHitMeshes], false);
      const hit = intersections.find((entry) => {
        if (!entry.object.visible) return false;
        const enemy = entry.object.userData.enemy as EnemyRuntime | undefined;
        return !enemy || enemy.alive;
      });
      let tracerEnd = this.camera.position.clone().addScaledVector(direction, 85);
      if (hit) {
        tracerEnd = hit.point.clone();
        const enemy = hit.object.userData.enemy as EnemyRuntime | undefined;
        const destructible = hit.object.userData.destructible as DestructibleRuntime | undefined;
        if (destructible && !destructible.destroyed) {
          this.damageDestructible(destructible, config.damage, hit.point, direction);
        } else if (enemy?.alive) {
          const headshot = hit.object.userData.hitZone === 'head';
          this.damageEnemy(enemy, headshot ? config.headshotDamage : config.damage, headshot);
        }
      }
      if (pellet === 0 || config.id === 'shotgun') {
        this.createTracer(this.camera.position.clone().addScaledVector(direction, 0.8), tracerEnd);
      }
    }
    if (weapon.magazine === 0 && weapon.reserve > 0) this.startReload();
  }

  private damageDestructible(
    destructible: DestructibleRuntime,
    damage: number,
    point: THREE.Vector3,
    direction: THREE.Vector3,
  ): void {
    if (destructible.destroyed) return;
    destructible.health -= damage;
    const surface: ImpactSurface = destructible.kind === 'prop' ? 'wood' : 'metal';
    this.spawnSurfaceImpact(point, direction.clone().multiplyScalar(-1), direction, surface);
    this.audio.surfaceImpact(surface, point);
    if (destructible.health > 0) return;
    destructible.destroyed = true;
    destructible.mesh.visible = false;
    destructible.collider?.setEnabled(false);
    if (destructible.linkedLight) {
      destructible.linkedLight.visible = false;
      destructible.linkedLight.userData.broken = true;
    }
    if (destructible.kind === 'barrel') {
      this.audio.destructibleExplosion(destructible.mesh.position);
      this.spawnImpactParticles(destructible.mesh.position, new THREE.Vector3(0, 1, 0), 'metal', 28, true);
      const blastRadius = 5.5;
      for (const enemy of this.enemies) {
        if (!enemy.alive) continue;
        const distance = enemy.group.position.distanceTo(destructible.mesh.position);
        if (distance >= blastRadius) continue;
        this.damageEnemy(enemy, 58 * (1 - distance / blastRadius), 'body', enemy.group.position, direction);
      }
      const playerDistance = this.camera.position.distanceTo(destructible.mesh.position);
      if (playerDistance < blastRadius) this.damagePlayer(48 * (1 - playerDistance / blastRadius));
      this.callbacks.onToast('油桶爆炸，附近目标受到冲击', 'danger');
    } else if (destructible.kind === 'glass') {
      this.spawnImpactParticles(point, direction.clone().multiplyScalar(-1), 'armor', 16, true);
    } else if (destructible.kind === 'light') {
      this.callbacks.onToast('灯具已被击碎');
    }
  }

  private startReload(): void {
    const now = performance.now() / 1000;
    const weapon = this.run.player.weapon;
    const config = WEAPON_CONFIGS[this.activeWeaponId];
    if (weapon.reloading || weapon.magazine >= config.magazineSize || weapon.reserve <= 0) return;
    weapon.reloading = true;
    weapon.reloadEndsAt = now + config.reloadDuration;
    this.callbacks.onToast('正在更换弹匣');
    this.audio.tone(220, 0.07, 0.035);
  }

  private updateWeaponVisual(delta: number, now: number): void {
    if (!this.weapon) return;
    const targetX = this.aiming ? 0 : 0.27;
    const targetY = this.aiming ? -0.12 : -0.25;
    const blend = 1 - Math.pow(0.0001, delta);
    const moving = this.keys.has('KeyW') || this.keys.has('KeyS') || this.keys.has('KeyA') || this.keys.has('KeyD');
    const sprinting = this.keys.has('ShiftLeft') && moving;
    const gait = sprinting ? 13 : 9;
    const bob = moving ? Math.sin(now * gait) : 0;
    const reloadDuration = WEAPON_CONFIGS[this.activeWeaponId].reloadDuration;
    const reloadStart = this.run.player.weapon.reloadEndsAt - reloadDuration;
    const reloadProgress = this.run.player.weapon.reloading
      ? THREE.MathUtils.clamp((now - reloadStart) / reloadDuration, 0, 1)
      : 0;
    const recoil = Math.max(0, 1 - (now - this.lastShotAt) * 12);
    this.weapon.position.x = THREE.MathUtils.lerp(
      this.weapon.position.x,
      targetX + (moving ? bob * (sprinting ? 0.008 : 0.004) : 0),
      blend,
    );
    this.weapon.position.y = THREE.MathUtils.lerp(
      this.weapon.position.y,
      targetY + (moving ? Math.abs(bob) * (sprinting ? 0.012 : 0.006) : 0),
      blend,
    );
    this.weapon.rotation.z = moving ? bob * 0.012 : 0;
    this.weapon.rotation.x = reloadProgress > 0 ? Math.sin(reloadProgress * Math.PI) * 0.56 : recoil * 0.08;
    this.leftPlayerArm.rotation.z = -0.18 - bob * 0.08;
    this.rightPlayerArm.rotation.z = 0.18 + bob * 0.08;
    const fov = this.aiming ? 54 : 74;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, blend);
      this.camera.updateProjectionMatrix();
    }
  }

  private damageEnemy(
    enemy: EnemyRuntime,
    damage: number,
    headshot: boolean,
    hitPoint?: THREE.Vector3,
    hitDirection?: THREE.Vector3,
  ): void {
    enemy.health -= damage;
    this.callbacks.onHit(headshot);
    if (hitPoint) this.spawnBloodImpact(hitPoint, hitDirection ?? new THREE.Vector3(0, 0, -1), headshot);
    this.audio.tone(headshot ? 880 : 620, 0.045, 0.035);
    if (enemy.health <= 0) {
      enemy.alive = false;
      enemy.state = 'dead';
      enemy.vehicle.velocity.set(0, 0, 0);
      this.entityManager.remove(enemy.vehicle);
      enemy.group.rotation.z = Math.PI / 2;
      enemy.group.position.y = 0.36;
      enemy.body.material = new THREE.MeshStandardMaterial({ color: '#353a34', roughness: 1 });
      this.run.kills += 1;
      this.callbacks.onToast(headshot ? '威胁解除 · 精确命中' : '威胁解除');
    } else {
      this.setEnemyState(enemy, 'engage', this.camera.position);
    }
  }

  private updateEnemies(delta: number, now: number): void {
    const player = this.camera.position;
    for (const enemy of this.enemies) {
      if (enemy.trainingTarget) {
        enemy.vehicle.maxSpeed = 0;
        enemy.vehicle.velocity.set(0, 0, 0);
        enemy.alertLight.visible = false;
        enemy.muzzleLight.visible = false;
        if (!enemy.alive && now >= enemy.trainingResetAt) {
          enemy.alive = true;
          enemy.state = 'patrol';
          enemy.health = enemy.maxHealth;
          enemy.armorDurability = enemy.armorMaxDurability;
          enemy.armorBroken = false;
          enemy.armor.visible = true;
          enemy.hurtEndsAt = -100;
          enemy.deathStartedAt = -100;
          enemy.lastAnimationPosition.copy(enemy.group.position);
        }
        continue;
      }
      if (!enemy.alive) continue;
      const enemyEye = enemy.group.position.clone().add(new THREE.Vector3(0, 1.65, 0));
      const toPlayer = player.clone().sub(enemyEye);
      const distance = toPlayer.length();
      const direction = toPlayer.clone().normalize();
      const visible = distance < 32 && this.hasLineOfSight(enemyEye, player);
      const inCone = enemy.facing.dot(direction) > 0.55;
      const heardShot = now - this.lastShotAt < 0.8 && enemy.group.position.distanceTo(this.lastShotPosition) < 30;

      if (now >= this.combatGraceEndsAt && visible && (inCone || distance < 9 || enemy.state === 'engage')) {
        enemy.lastSeen.copy(player);
        this.setEnemyState(enemy, 'engage', player);
      } else if (heardShot && enemy.state === 'patrol') {
        enemy.lastSeen.copy(this.lastShotPosition);
        this.setEnemyState(enemy, 'investigate', this.lastShotPosition);
      } else if (enemy.state === 'engage' && now - enemy.lastStateChange > 4.5) {
        this.setEnemyState(enemy, 'search', enemy.lastSeen);
      } else if ((enemy.state === 'investigate' || enemy.state === 'search') && enemy.group.position.distanceTo(enemy.lastSeen) < 2) {
        if (now - enemy.lastStateChange > 3.2) this.setEnemyState(enemy, 'return', enemy.home);
      } else if (enemy.state === 'return' && enemy.group.position.distanceTo(enemy.home) < 2) {
        this.setEnemyState(enemy, 'patrol', enemy.home);
      }

      if (enemy.state === 'engage') {
        enemy.facing.lerp(direction.setY(0).normalize(), Math.min(1, delta * 5));
        enemy.group.lookAt(player.x, enemy.group.position.y + 1, player.z);
        enemy.seek.target.set(player.x, 0, player.z);
        enemy.vehicle.maxSpeed = distance > 15 ? 1.6 : 0;
        enemy.fireCooldown -= delta;
        if (visible && distance < 27 && enemy.fireCooldown <= 0) this.enemyFire(enemy, distance);
      }
    }

    this.entityManager.update(delta);
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const previous = enemy.group.position.clone();
      enemy.group.position.set(enemy.vehicle.position.x, 0, enemy.vehicle.position.z);
      const moved = enemy.group.position.clone().sub(previous).setY(0);
      const walking = moved.lengthSq() > 0.0001;
      const stride = walking ? Math.sin(now * (enemy.state === 'engage' ? 10 : 7) + enemy.home.x) * 0.58 : 0;
      enemy.leftLeg.rotation.x = stride;
      enemy.rightLeg.rotation.x = -stride;
      enemy.leftArm.rotation.x = -stride * 0.72;
      enemy.rightArm.rotation.x = stride * 0.72;
      if (moved.lengthSq() > 0.0001 && enemy.state !== 'engage') {
        enemy.facing.lerp(moved.normalize(), Math.min(1, delta * 5));
        enemy.group.lookAt(enemy.group.position.clone().add(enemy.facing));
      }
    }
  }

  private setEnemyState(enemy: EnemyRuntime, state: EnemyState, target: THREE.Vector3): void {
    if (enemy.state === state) {
      if (state === 'engage') enemy.seek.target.set(target.x, 0, target.z);
      return;
    }
    const previous = enemy.state;
    enemy.state = state;
    if (previous !== state) enemy.lastStateChange = performance.now() / 1000;
    enemy.vehicle.steering.clear();
    if (state === 'patrol') {
      enemy.vehicle.maxSpeed = 1.3;
      enemy.vehicle.steering.add(new YUKA.FollowPathBehavior(enemy.path, 0.7));
    } else if (state !== 'dead') {
      enemy.seek.target.set(target.x, 0, target.z);
      enemy.vehicle.maxSpeed = state === 'engage' ? 1.6 : 1.35;
      enemy.vehicle.steering.add(enemy.seek);
    }
  }

  private enemyFire(enemy: EnemyRuntime, distance: number): void {
    const difficulty = DIFFICULTIES[this.activeDifficulty];
    if (enemy.burstRemaining <= 0) enemy.burstRemaining = 2;
    enemy.burstRemaining -= 1;
    enemy.fireCooldown = (enemy.burstRemaining > 0 ? 0.18 : 1.6 + Math.random() * 0.8) * difficulty.fireDelay;
    this.audio.shot(0.055);
    const origin = enemy.group.position.clone().add(new THREE.Vector3(0.3, 1.25, 0));
    const target = this.camera.position.clone();
    const accuracy = THREE.MathUtils.clamp((0.34 - distance * 0.006) * difficulty.accuracy, 0.08, 0.42);
    const hit = Math.random() < accuracy;
    if (!hit) target.add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2 - 0.5, (Math.random() - 0.5) * 3));
    this.createTracer(origin, target);
    if (hit) this.damagePlayer((6 + Math.floor(Math.random() * 4)) * difficulty.damage);
  }

  private hasLineOfSight(origin: THREE.Vector3, target: THREE.Vector3): boolean {
    const direction = target.clone().sub(origin);
    const distance = direction.length();
    const normalized = direction.clone().normalize();
    const physicsHit = this.physicsWorld.castRay(
      new RAPIER.Ray(
        { x: origin.x, y: origin.y, z: origin.z },
        { x: normalized.x, y: normalized.y, z: normalized.z },
      ),
      distance,
      true,
    );
    if (physicsHit) {
      const hit = physicsHit as unknown as {
        collider?: RAPIER.Collider;
        colliderHandle?: number;
        timeOfImpact?: number;
        toi?: number;
      };
      const timeOfImpact = hit.timeOfImpact ?? hit.toi ?? distance;
      const hitPlayer =
        hit.collider?.handle === this.playerCollider.handle ||
        hit.colliderHandle === this.playerCollider.handle;
      if (!hitPlayer && timeOfImpact < distance - 0.45) return false;
    }
    this.raycaster.set(origin, normalized);
    this.raycaster.far = distance;
    const hit = this.raycaster.intersectObjects(this.blockers, false)[0];
    return !hit || hit.distance >= distance - 0.2;
  }

  private damagePlayer(rawDamage: number): void {
    if (!['active', 'extracting'].includes(this.run.phase)) return;
    if (this.lootSearch) this.cancelLootSearch('受到攻击，搜索中断');
    const next = applyDamage(this.run.player.health, this.run.player.armor, rawDamage);
    this.run.player.health = next.health;
    this.run.player.armor = next.armor;
    const now = performance.now() / 1000;
    this.lastDamagedAt = now;
    this.weaponHurtStartedAt = now;
    this.weaponHurtEndsAt = now + 0.42;
    this.weaponHurtSide *= -1;
    this.firing = false;
    this.setAiming(false);
    this.run.extractionProgress = 0;
    if (this.operationScenario.extractionCondition.type === 'wait-helicopter') {
      this.extractionConditionProgress = advanceExtractionCondition(this.operationScenario.extractionCondition, 0, 0);
    }
    this.callbacks.onDamage();
    this.audio.tone(82, 0.12, 0.07);
    if (next.health <= 0) this.failRun('人员失联');
  }

  private useMedkit(): void {
    if (!['active', 'extracting'].includes(this.run.phase)) return;
    if (this.run.player.medkits <= 0 || this.run.player.health >= 100 || this.healingEndsAt > 0) return;
    this.run.player.medkits -= 1;
    this.healingEndsAt = performance.now() / 1000 + 1.25;
    this.callbacks.onToast('正在处理伤势');
    this.audio.tone(360, 0.08, 0.035);
  }

  private completeHealing(now: number): void {
    if (this.healingEndsAt === 0 || now < this.healingEndsAt) return;
    this.healingEndsAt = 0;
    this.run.player.health = Math.min(100, this.run.player.health + 35);
    this.callbacks.onToast('生命状态已稳定');
    this.audio.tone(620, 0.12, 0.04);
  }

  private updateInteraction(): void {
    if (this.lootSearch) {
      this.nearestInteraction = this.lootSearch.entry;
      this.callbacks.onPrompt(this.lootSearch.revealed ? '收入已识别物资' : '正在搜索容器');
      return;
    }
    const playerPosition = this.camera.position;
    let nearest: LootRuntime | 'objective' | null = null;
    let nearestDistance = 2.35;
    if (this.objectiveCase.visible) {
      const distance = playerPosition.distanceTo(this.objectiveCase.position);
      if (distance < nearestDistance) {
        nearest = 'objective';
        nearestDistance = distance;
      }
    }
    for (const entry of this.loot) {
      if (entry.opened || entry.operationId !== this.activeOperation.id) continue;
      const distance = playerPosition.distanceTo(entry.position);
      if (distance < nearestDistance) {
        nearest = entry;
        nearestDistance = distance;
      }
    }
    this.nearestInteraction = nearest;
    if (nearest === 'objective') this.callbacks.onPrompt('回收加密硬盘');
    else if (nearest) this.callbacks.onPrompt(`搜索 ${nearest.containerName}`);
    else this.callbacks.onPrompt(null);
  }

  private startLootSearch(entry: LootRuntime): void {
    this.lootSearch = {
      entry,
      startedAt: performance.now() / 1000,
      duration: entry.tier === 'safe' ? 4.2 : entry.tier === 'military' ? 3.3 : entry.tier === 'case' ? 2.5 : 1.8,
      revealed: false,
    };
    this.firing = false;
    this.callbacks.onLootSearch({
      items: entry.items,
      containerName: entry.containerName,
      phase: 'searching',
      progress: 0,
      message: '正在检索容器内容',
    });
    this.callbacks.onPrompt('正在搜索容器');
    this.audio.tone(300, 0.06, 0.025);
  }

  private updateLootSearch(now: number): void {
    const search = this.lootSearch;
    if (!search) return;
    if (this.camera.position.distanceTo(search.entry.position) > 2.8) {
      this.cancelLootSearch('距离过远，搜索中断');
      return;
    }
    if (search.revealed) return;
    const progress = THREE.MathUtils.clamp((now - search.startedAt) / search.duration, 0, 1);
    const lid = search.entry.mesh.userData.lid as THREE.Mesh | undefined;
    if (lid) {
      lid.position.y = 0.2 + progress * 0.22;
      lid.position.z = -progress * 0.08;
      lid.rotation.x = -progress * 0.82;
    }
    this.callbacks.onLootSearch({
      items: search.entry.items,
      containerName: search.entry.containerName,
      phase: 'searching',
      progress,
      message: '正在检索容器内容',
    });
    if (progress < 1) return;
    search.revealed = true;
    this.callbacks.onLootSearch({
      items: search.entry.items,
      containerName: search.entry.containerName,
      phase: 'revealed',
      progress: 1,
      message: '物资已识别 · 按 E 收入背包',
    });
    this.callbacks.onPrompt('收入已识别物资');
    const hasHighValue = search.entry.items.some((item) => item.rarity === 'red' || item.rarity === 'gold');
    this.audio.tone(hasHighValue ? 780 : 560, 0.14, 0.045);
  }

  private takeSearchedLoot(): void {
    const search = this.lootSearch;
    if (!search?.revealed) return;
    let backpack = this.run.backpack;
    let collected = 0;
    for (const item of search.entry.items) {
      const result = addInventoryItem(backpack, item);
      if (!result.added) continue;
      backpack = result.items;
      collected += 1;
    }
    if (collected === 0) {
      this.callbacks.onToast('背包空间不足', 'danger');
      return;
    }
    this.run.backpack = backpack;
    search.entry.opened = true;
    search.entry.mesh.visible = false;
    this.nearestInteraction = null;
    this.callbacks.onLootSearch(null);
    this.callbacks.onPrompt(null);
    this.callbacks.onToast(`已取得 ${collected} 件物资`);
    this.audio.tone(620, 0.1, 0.045);
    this.lootSearch = null;
  }

  private cancelLootSearch(message?: string): void {
    const search = this.lootSearch;
    if (!search) {
      this.callbacks.onLootSearch(null);
      return;
    }
    const lid = search.entry.mesh.userData.lid as THREE.Mesh | undefined;
    if (lid && !search.entry.opened) {
      lid.position.set(0, 0.2, 0);
      lid.rotation.set(0, 0, 0);
    }
    this.lootSearch = null;
    this.callbacks.onLootSearch(null);
    if (message) this.callbacks.onToast(message, 'danger');
  }

  private interact(): void {
    if (!['active', 'extracting'].includes(this.run.phase)) return;
    if (this.lootSearch) {
      if (this.lootSearch.revealed) this.takeSearchedLoot();
      return;
    }
    if (this.nearestInteraction === 'objective') {
      this.takeObjective();
      return;
    }
    if (!this.nearestInteraction) return;
    const entry = this.nearestInteraction;
    this.startLootSearch(entry);
  }

  private takeObjective(): void {
    if (this.activeGameMode !== 'extraction') return;
    if (this.run.hasObjective) return;
    this.run.hasObjective = true;
    this.objectiveCase.visible = false;
    this.run.objectiveText = `携带任务物品，前往 ${this.activeOperation.name} 撤离区`;
    this.callbacks.onPrompt(null);
    this.callbacks.onToast('主目标已回收 · 撤离点开放');
    this.audio.tone(720, 0.18, 0.055);
  }

  private updateExtraction(delta: number, now: number): void {
    const position = this.camera.position;
    const distance = Math.hypot(position.x - this.activeOperation.extraction.x, position.z - this.activeOperation.extraction.z);
    if (distance > 5.5) {
      this.run.extractionProgress = 0;
      if (this.operationScenario.extractionCondition.type === 'wait-helicopter') {
        this.extractionConditionProgress = advanceExtractionCondition(this.operationScenario.extractionCondition, 0, 0);
      }
      if (this.run.phase === 'extracting') this.run.phase = 'active';
      if (this.run.hasObjective) this.run.objectiveText = '携带任务物品，前往标记的撤离区';
      return;
    }
    if (!this.isCoreMissionReady() || this.isOperationEventActive('extraction-closure')) {
      this.callbacks.onPrompt(this.modeLockedMessage());
      return;
    }
    const condition = this.operationScenario.extractionCondition;
    if (condition.type !== 'wait-helicopter' && !this.extractionConditionProgress.completed) {
      this.callbacks.onPrompt(this.modeLockedMessage());
      return;
    }
    if (now - this.lastDamagedAt < 0.8) {
      this.run.extractionProgress = 0;
      return;
    }
    this.run.phase = 'extracting';
    if (condition.type === 'wait-helicopter') {
      this.extractionConditionProgress = advanceExtractionCondition(
        condition,
        this.extractionConditionProgress.current,
        delta,
      );
      this.run.extractionProgress = this.extractionConditionProgress.current;
      this.run.objectiveText = `保持位置，等待直升机（${Math.ceil(condition.requiredProgress - this.run.extractionProgress)} 秒）`;
      if (this.extractionConditionProgress.completed) this.completeRun();
      return;
    }
    this.run.extractionProgress += delta;
    this.run.objectiveText = '保持位置，等待撤离信号确认';
    if (this.run.extractionProgress >= 6) this.completeRun();
  }

  private completeRun(): void {
    if (this.run.phase === 'success') return;
    if (this.activeGameMode === 'continuous' && this.continuousStage < 2) {
      this.advanceContinuousOperation();
      return;
    }
    if (this.activeGameMode === 'continuous' && this.continuousElapsedTotal > 0) {
      this.run.elapsedSeconds += this.continuousElapsedTotal;
      this.continuousElapsedTotal = 0;
    }
    for (const item of this.run.backpack) {
      this.challengeProgress = updateChallengeSet(
        this.challengeProgress,
        this.challengeDefinitions,
        { type: 'item-extracted', itemId: item.id, quantity: item.quantity },
      );
    }
    this.challengeProgress = updateChallengeSet(
      this.challengeProgress,
      this.challengeDefinitions,
      { type: 'extracted' },
    );
    if (this.challengeProgress.some((challenge) => challenge.completed)) {
      const reward: InventoryItem = {
        id: `challenge-reward-${this.challengeDefinitions[0].id}`,
        name: `${this.challengeDefinitions[0].name}纪念章`,
        kind: 'intel',
        rarity: 'gold',
        value: 3600,
        quantity: 1,
        description: '完成本局小型挑战获得的高价值奖励。',
      };
      this.run.backpack = addInventoryItem(this.run.backpack, reward, Number.POSITIVE_INFINITY).items;
      this.callbacks.onToast(`挑战完成 · 获得 ${reward.name}`);
    }
    this.run.phase = 'success';
    this.callbacks.onUpdate(this.run);
    this.callbacks.onDeploying(false);
    this.callbacks.onControlCapture(false);
    this.callbacks.onPrompt(null);
    this.cancelLootSearch();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.audio.tone(840, 0.35, 0.06);
    this.callbacks.onEnd(this.run, true);
  }

  private advanceContinuousOperation(): void {
    const mapOrder: MapId[] = ['harbor', 'radar', 'refinery', 'administration'];
    const currentIndex = mapOrder.indexOf(this.activeOperation.id);
    const nextMap = mapOrder[(currentIndex + 1) % mapOrder.length];
    this.continuousElapsedTotal += this.run.elapsedSeconds;
    this.continuousStage += 1;
    this.activeOperation = OPERATIONS[nextMap];
    this.run.elapsedSeconds = 0;
    this.run.extractionProgress = 0;
    this.run.hasObjective = false;
    this.run.objectiveText = `连续行动 ${this.continuousStage + 1}/3 · ${this.activeOperation.objectiveText}`;
    this.carriedObjective = false;
    this.carriedCargo.visible = false;
    this.weapon.visible = this.availableWeapons.has(this.activeWeaponId);
    this.extractionIntelUnlocked = true;
    this.focusSunOnOperation();
    this.configureOperationSystems();
    this.resetDynamicWorld();
    this.prepareModeLoot();
    this.applyModeEnvironment();
    this.run.phase = 'deploying';
    this.deployEndsAt = performance.now() / 1000 + 1.2;
    this.combatGraceEndsAt = performance.now() / 1000 + 7;
    this.callbacks.onDeploying(true);
    this.callbacks.onUpdate(this.run);
    this.callbacks.onMiniMap(this.createMiniMapView());
    this.callbacks.onToast(`连续行动 ${this.continuousStage + 1}/3 · 进入${this.activeOperation.name}`);
    this.audio.tone(780, 0.28, 0.055);
  }

  private failRun(message: string): void {
    if (this.run.phase === 'failed' || this.run.phase === 'success') return;
    this.challengeProgress = updateChallengeSet(
      this.challengeProgress,
      this.challengeDefinitions,
      { type: 'failed' },
    );
    this.run.phase = 'failed';
    this.run.objectiveText = message;
    this.callbacks.onUpdate(this.run);
    this.callbacks.onDeploying(false);
    this.callbacks.onControlCapture(false);
    this.callbacks.onPrompt(null);
    this.cancelLootSearch();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.callbacks.onEnd(this.run, false);
  }

  private spawnShellCasing(): void {
    const shell = this.shells.find((entry) => entry.life <= 0);
    if (!shell) return;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    shell.mesh.position.copy(this.camera.position)
      .addScaledVector(right, 0.3)
      .addScaledVector(up, -0.18)
      .addScaledVector(forward, 0.48);
    shell.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    shell.velocity.copy(right).multiplyScalar(1.1 + Math.random() * 0.7)
      .addScaledVector(up, 0.65 + Math.random() * 0.5)
      .addScaledVector(forward, (Math.random() - 0.5) * 0.35);
    shell.spin.set(9 + Math.random() * 8, 12 + Math.random() * 10, 6 + Math.random() * 8);
    shell.life = 0.85;
    shell.mesh.visible = true;
  }

  private spawnBloodImpact(point: THREE.Vector3, direction: THREE.Vector3, headshot: boolean): void {
    const particleCount = headshot ? 9 : 6;
    const away = direction.clone().normalize().multiplyScalar(-1);
    let spawned = 0;
    for (const particle of this.bloodParticles) {
      if (particle.life > 0) continue;
      particle.mesh.position.copy(point).add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.12,
        (Math.random() - 0.5) * 0.12,
        (Math.random() - 0.5) * 0.12,
      ));
      particle.mesh.scale.setScalar(0.55 + Math.random() * (headshot ? 0.8 : 0.55));
      particle.velocity.copy(away).multiplyScalar(0.7 + Math.random() * 1.1).add(new THREE.Vector3(
        (Math.random() - 0.5) * 1.3,
        0.25 + Math.random() * 1.1,
        (Math.random() - 0.5) * 1.3,
      ));
      particle.maxLife = 0.25 + Math.random() * 0.22;
      particle.life = particle.maxLife;
      particle.mesh.visible = true;
      spawned += 1;
      if (spawned >= particleCount) break;
    }
  }

  private resolveImpactSurface(object: THREE.Object3D, materialIndex: number): ImpactSurface {
    const explicitObjectSurface = object.userData.surface as ImpactSurface | undefined;
    if (explicitObjectSurface) return explicitObjectSurface;
    const mesh = object as THREE.Mesh;
    const sourceMaterial = Array.isArray(mesh.material)
      ? mesh.material[Math.min(materialIndex, mesh.material.length - 1)]
      : mesh.material;
    const explicitMaterialSurface = sourceMaterial?.userData.surface as ImpactSurface | undefined;
    if (explicitMaterialSurface) return explicitMaterialSurface;
    const metalness = 'metalness' in (sourceMaterial ?? {})
      ? Number((sourceMaterial as THREE.MeshStandardMaterial).metalness)
      : 0;
    return metalness >= 0.2 ? 'metal' : 'dirt';
  }

  private spawnSurfaceImpact(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    incoming: THREE.Vector3,
    surface: ImpactSurface,
  ): void {
    const away = normal.lengthSq() > 0.01 ? normal.clone().normalize() : incoming.clone().normalize().multiplyScalar(-1);
    const count = surface === 'metal' ? 9 : surface === 'wood' ? 8 : 10;
    this.spawnImpactParticles(point, away, surface, count, false);
  }

  private spawnArmorImpact(point: THREE.Vector3, incoming: THREE.Vector3, broken: boolean): void {
    const away = incoming.clone().normalize().multiplyScalar(-1);
    this.spawnImpactParticles(point, away, broken ? 'armor' : 'metal', broken ? 22 : 6, broken);
  }

  private spawnImpactParticles(
    point: THREE.Vector3,
    away: THREE.Vector3,
    kind: ImpactSurface | 'armor',
    count: number,
    largeFragments: boolean,
  ): void {
    let spawned = 0;
    for (const particle of this.impactParticles) {
      if (particle.life > 0) continue;
      const dust = kind === 'dirt';
      const metalSpark = kind === 'metal' && !largeFragments;
      particle.mesh.material = this.impactMaterials[kind];
      particle.mesh.position.copy(point).addScaledVector(away, 0.025 + Math.random() * 0.04);
      particle.velocity.copy(away).multiplyScalar(
        dust ? 0.35 + Math.random() * 0.75 : largeFragments ? 1.1 + Math.random() * 2.2 : 0.8 + Math.random() * 2.6,
      ).add(new THREE.Vector3(
        (Math.random() - 0.5) * (dust ? 1.1 : 2.6),
        Math.random() * (dust ? 0.8 : 1.8),
        (Math.random() - 0.5) * (dust ? 1.1 : 2.6),
      ));
      const size = dust ? 0.75 + Math.random() * 1.15 : largeFragments ? 0.9 + Math.random() * 1.35 : 0.34 + Math.random() * 0.55;
      particle.mesh.scale.set(size, size, metalSpark ? size * 3.8 : size);
      if (metalSpark && particle.velocity.lengthSq() > 0.01) {
        particle.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), particle.velocity.clone().normalize());
      } else {
        particle.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      }
      particle.spin.set(
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 18,
      );
      particle.maxLife = dust ? 0.34 + Math.random() * 0.24 : largeFragments ? 0.48 + Math.random() * 0.38 : 0.18 + Math.random() * 0.2;
      particle.life = particle.maxLife;
      particle.gravity = dust ? 0.8 : largeFragments ? 5.4 : 7.2;
      particle.grow = dust ? 1.8 : 0;
      particle.mesh.visible = true;
      spawned += 1;
      if (spawned >= count) break;
    }
  }

  private updateWeaponEffects(delta: number, now: number): void {
    if (this.muzzleFlash.visible && now >= this.muzzleFlashEndsAt) {
      this.muzzleFlash.visible = false;
      this.muzzleFlashLight.intensity = 0;
    }
    this.updateTracers(delta);
    for (const shell of this.shells) {
      if (shell.life <= 0) continue;
      shell.life -= delta;
      shell.velocity.y -= 7.2 * delta;
      shell.mesh.position.addScaledVector(shell.velocity, delta);
      shell.mesh.rotation.x += shell.spin.x * delta;
      shell.mesh.rotation.y += shell.spin.y * delta;
      shell.mesh.rotation.z += shell.spin.z * delta;
      if (shell.mesh.position.y < 0.04) {
        shell.mesh.position.y = 0.04;
        shell.velocity.multiplyScalar(0.34);
        shell.velocity.y = Math.abs(shell.velocity.y) * 0.25;
      }
      if (shell.life <= 0) shell.mesh.visible = false;
    }
    for (const particle of this.bloodParticles) {
      if (particle.life <= 0) continue;
      particle.life -= delta;
      particle.velocity.y -= 3.6 * delta;
      particle.mesh.position.addScaledVector(particle.velocity, delta);
      particle.mesh.scale.multiplyScalar(Math.max(0.86, 1 - delta * 2.9));
      if (particle.life <= 0) particle.mesh.visible = false;
    }
    for (const particle of this.impactParticles) {
      if (particle.life <= 0) continue;
      particle.life -= delta;
      particle.velocity.y -= particle.gravity * delta;
      particle.velocity.multiplyScalar(Math.max(0.84, 1 - delta * (particle.grow > 0 ? 3.4 : 0.8)));
      particle.mesh.position.addScaledVector(particle.velocity, delta);
      particle.mesh.rotation.x += particle.spin.x * delta;
      particle.mesh.rotation.y += particle.spin.y * delta;
      particle.mesh.rotation.z += particle.spin.z * delta;
      if (particle.grow > 0) particle.mesh.scale.multiplyScalar(1 + particle.grow * delta);
      else particle.mesh.scale.multiplyScalar(Math.max(0.9, 1 - delta * 1.8));
      if (particle.life <= 0) particle.mesh.visible = false;
    }
  }

  private createTracer(start: THREE.Vector3, end: THREE.Vector3): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({ color: '#ffd77b', transparent: true, opacity: 0.82 });
    const line = new THREE.Line(geometry, material);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.07 });
  }

  private updateTracers(delta: number): void {
    for (let index = this.tracers.length - 1; index >= 0; index -= 1) {
      const tracer = this.tracers[index];
      tracer.life -= delta;
      if (tracer.life <= 0) {
        this.scene.remove(tracer.line);
        tracer.line.geometry.dispose();
        (tracer.line.material as THREE.Material).dispose();
        this.tracers.splice(index, 1);
      }
    }
  }

  private formatHeading(): string {
    const degrees = ((THREE.MathUtils.radToDeg(this.yaw) % 360) + 360) % 360;
    const cardinal = degrees < 45 || degrees >= 315 ? 'N' : degrees < 135 ? 'E' : degrees < 225 ? 'S' : 'W';
    return `${cardinal}   ${String(Math.round(degrees)).padStart(3, '0')}°`;
  }

  private teleport(x: number, z: number): void {
    const safe = this.findNearbyClearPosition(x, z);
    this.playerBody.setTranslation({ x: safe.x, y: 0.9, z: safe.z }, true);
    this.playerBody.setNextKinematicTranslation({ x: safe.x, y: 0.9, z: safe.z });
    this.camera.position.set(safe.x, 1.52, safe.z);
  }

  private findNearbyClearPosition(x: number, z: number): { x: number; z: number } {
    const offsets: Array<[number, number]> = [
      [0, 0], [2, 0], [-2, 0], [0, 2], [0, -2],
      [3.5, 3.5], [-3.5, 3.5], [3.5, -3.5], [-3.5, -3.5],
      [6, 0], [-6, 0], [0, 6], [0, -6],
    ];
    const bounds = new THREE.Box3();
    const isClear = (candidateX: number, candidateZ: number): boolean => {
      for (const blocker of this.blockers) {
        if ((blocker as THREE.InstancedMesh).isInstancedMesh || !blocker.visible) continue;
        bounds.setFromObject(blocker);
        if (bounds.max.y <= 0.24 || bounds.min.y >= 2.1) continue;
        if (
          candidateX >= bounds.min.x - 0.62 && candidateX <= bounds.max.x + 0.62
          && candidateZ >= bounds.min.z - 0.62 && candidateZ <= bounds.max.z + 0.62
        ) return false;
      }
      return true;
    };
    for (const [offsetX, offsetZ] of offsets) {
      const candidateX = x + offsetX;
      const candidateZ = z + offsetZ;
      if (isClear(candidateX, candidateZ)) return { x: candidateX, z: candidateZ };
    }
    return { x, z };
  }
}
