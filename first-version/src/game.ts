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
    gain.gain.setValueAtTime(volume, now);
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

export class CriticalExtractionGame {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: GameCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.06, 260);
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera.rotation.order = 'YXZ';
  }

  async initialize(): Promise<void> {
    await RAPIER.init();
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

  startRun(): void {
    this.audio.unlock();
    this.run = createRunState();
    this.run.phase = 'deploying';
    this.resetDynamicWorld();
    this.yaw = 0;
    this.pitch = 0;
    this.verticalVelocity = 0;
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
    this.teleport(45, -42);
  }

  debugDamage(amount = 20): void {
    this.damagePlayer(amount);
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
    this.scene.background = new THREE.Color('#8b9997');
    this.scene.fog = new THREE.FogExp2('#899694', 0.0095);

    const hemisphere = new THREE.HemisphereLight('#d7ded6', '#3f493c', 1.55);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight('#fff0ce', 3.2);
    sun.position.set(-35, 58, 28);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -70;
    sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -70;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 140;
    sun.shadow.bias = -0.0003;
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

  private buildContainers(): void {
    const geometry = new THREE.BoxGeometry(6, 2.6, 2.5);
    const materials = [
      new THREE.MeshStandardMaterial({ color: '#566b64', roughness: 0.74, metalness: 0.38 }),
      new THREE.MeshStandardMaterial({ color: '#805c46', roughness: 0.78, metalness: 0.28 }),
      new THREE.MeshStandardMaterial({ color: '#656959', roughness: 0.8, metalness: 0.3 }),
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

  private addSetDressing(concrete: THREE.Material, metal: THREE.Material): void {
    const barrelGeometry = new THREE.CylinderGeometry(0.42, 0.42, 0.95, 12);
    const barrelMaterial = new THREE.MeshStandardMaterial({ color: '#7d6546', roughness: 0.68, metalness: 0.32 });
    const barrelPositions = [[-40, 32], [-39, 33], [11, 0], [12, 0.8], [34, -9], [35, -9]];
    for (const [x, z] of barrelPositions) {
      const barrel = new THREE.Mesh(barrelGeometry, barrelMaterial);
      barrel.position.set(x, 0.48, z);
      barrel.castShadow = true;
      this.scene.add(barrel);
    }
    for (const [x, z] of [[-47, 5], [-47, -2], [52, 22], [52, 14]]) {
      this.addBox(x, 1.25, z, 2.4, 2.5, 2.4, concrete, true);
    }
    this.addBox(16, 1.6, 40, 13, 3.2, 0.6, metal, true);
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
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    context.fillStyle = base;
    context.fillRect(0, 0, 256, 256);
    const random = new SeededRandom(kind.length * 913);
    for (let index = 0; index < 1800; index += 1) {
      const alpha = 0.025 + random.next() * 0.1;
      context.fillStyle = `${accent}${Math.floor(alpha * 255).toString(16).padStart(2, '0')}`;
      const size = 1 + random.next() * 3;
      context.fillRect(random.next() * 256, random.next() * 256, size, size);
    }
    context.globalAlpha = 0.22;
    context.strokeStyle = accent;
    if (kind === 'concrete') {
      context.beginPath();
      context.moveTo(0, 132);
      context.bezierCurveTo(62, 119, 150, 145, 256, 126);
      context.stroke();
    } else if (kind === 'metal') {
      for (let x = 0; x < 256; x += 32) {
        context.fillRect(x, 0, 2, 256);
      }
    }
    context.globalAlpha = 1;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(kind === 'asphalt' ? 18 : 3, kind === 'asphalt' ? 15 : 3);
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return texture;
  }

  private createPlayerPhysics(): void {
    this.playerBody = this.physicsWorld.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.9, 42),
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
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.62), bodyMaterial);
    receiver.position.set(0, -0.03, -0.22);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.54, 10), bodyMaterial);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.01, -0.73);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.12), gripMaterial);
    grip.rotation.x = -0.2;
    grip.position.set(0, -0.16, -0.18);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.12), bodyMaterial);
    sight.position.set(0, 0.12, -0.31);
    this.weapon.add(receiver, barrel, grip, sight);
    this.weapon.position.set(0.27, -0.25, -0.52);
    this.camera.add(this.weapon);
    this.scene.add(this.camera);

    this.muzzleFlash = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: '#ffd887' }),
    );
    this.muzzleFlash.position.set(0, 0.01, -1.03);
    this.muzzleFlash.visible = false;
    this.weapon.add(this.muzzleFlash);
  }

  private createObjectiveAndLoot(): void {
    this.objectiveCase = this.makeSupplyCase('#262b27', '#d3e468');
    this.objectiveCase.position.set(-18, 0.42, -16);
    this.scene.add(this.objectiveCase);

    this.extractionMarker = new THREE.Mesh(
      new THREE.CylinderGeometry(5.5, 5.5, 0.04, 48),
      new THREE.MeshBasicMaterial({ color: '#a7c850', transparent: true, opacity: 0.34, depthWrite: false }),
    );
    this.extractionMarker.position.set(45, 0.035, -42);
    this.scene.add(this.extractionMarker);

    const random = new SeededRandom(1709);
    LOOT_POSITIONS.forEach(([x, z], index) => {
      const source = random.pick(LOOT_TABLE);
      const item = { ...source, quantity: source.rarity === 'common' && index % 3 === 0 ? 2 : 1 };
      const mesh = this.makeSupplyCase('#454c43', source.rarity === 'valuable' ? '#e4bf55' : '#7e9674');
      mesh.scale.setScalar(0.72);
      mesh.position.set(x, 0.32, z);
      mesh.rotation.y = random.next() * Math.PI;
      this.scene.add(mesh);
      this.loot.push({ mesh, position: new THREE.Vector3(x, 0.32, z), item, opened: false });
    });
  }

  private makeSupplyCase(bodyColor: string, trimColor: string): THREE.Group {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.74, metalness: 0.26 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: trimColor, roughness: 0.62, metalness: 0.32 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.45, 0.72), bodyMaterial);
    body.castShadow = true;
    const trimA = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.49, 0.76), trimMaterial);
    trimA.position.x = -0.39;
    const trimB = trimA.clone();
    trimB.position.x = 0.39;
    group.add(body, trimA, trimB);
    return group;
  }

  private resetDynamicWorld(): void {
    for (const enemy of this.enemies) this.scene.remove(enemy.group);
    for (const tracer of this.tracers) this.scene.remove(tracer.line);
    this.enemies.length = 0;
    this.enemyHitMeshes.length = 0;
    this.tracers.length = 0;
    this.entityManager = new YUKA.EntityManager();
    this.objectiveCase.visible = true;
    this.lastDamagedAt = -100;
    this.lastShotAt = -100;
    this.nextShotAt = 0;
    this.healingEndsAt = 0;
    this.firing = false;
    this.aiming = false;
    this.loot.forEach((entry) => {
      entry.opened = false;
      entry.mesh.visible = true;
    });
    this.createEnemies();
    this.teleport(0, 42);
    this.callbacks.onPrompt(null);
  }

  private createEnemies(): void {
    const random = new SeededRandom(91173);
    ENEMY_POSITIONS.forEach(([x, z], index) => {
      const group = new THREE.Group();
      const uniform = new THREE.MeshStandardMaterial({ color: index % 2 ? '#505b4f' : '#5b5547', roughness: 0.86 });
      const vest = new THREE.MeshStandardMaterial({ color: '#252b26', roughness: 0.8 });
      const skin = new THREE.MeshStandardMaterial({ color: '#9c806d', roughness: 0.9 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.8, 4, 8), uniform);
      body.position.y = 1.02;
      body.castShadow = true;
      const armor = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.32), vest);
      armor.position.set(0, 1.2, 0.07);
      armor.castShadow = true;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 8), skin);
      head.position.y = 1.72;
      head.castShadow = true;
      const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.8), vest);
      weapon.position.set(0.32, 1.12, 0.22);
      weapon.rotation.x = -0.12;
      group.add(body, armor, head, weapon);
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
        vehicle,
        path,
        seek,
        state: 'patrol',
        health: 100,
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
    this.extractionMarker.material.opacity = 0.25 + Math.sin(now * 2.8) * 0.09;
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
    if (this.run.elapsedSeconds >= 480) {
      this.failRun('撤离窗口关闭');
      return;
    }
    this.updatePlayer(delta);
    this.updateWeapon(delta, now);
    this.updateEnemies(delta, now);
    this.updateInteraction();
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

    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw));
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
    this.cameraHeight = THREE.MathUtils.lerp(this.cameraHeight, crouching ? 0.22 : 0.62, 1 - Math.pow(0.001, delta));
    this.camera.position.set(next.x, next.y + this.cameraHeight, next.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  private updateWeapon(_delta: number, now: number): void {
    const weapon = this.run.player.weapon;
    if (weapon.reloading && now >= weapon.reloadEndsAt) {
      this.run.player.weapon = completeReload(weapon);
      this.audio.tone(510, 0.06, 0.04);
    }
    if (this.firing && !weapon.reloading && now >= this.nextShotAt) this.fireWeapon(now);
  }

  private fireWeapon(now: number): void {
    const weapon = this.run.player.weapon;
    if (weapon.magazine <= 0) {
      this.nextShotAt = now + 0.2;
      this.audio.tone(120, 0.05, 0.05);
      return;
    }
    weapon.magazine -= 1;
    this.nextShotAt = now + 1 / 9;
    this.lastShotAt = now;
    this.lastShotPosition.copy(this.camera.position);
    this.pitch = Math.min(1.42, this.pitch + (this.aiming ? 0.006 : 0.014));
    this.yaw += (Math.random() - 0.5) * (this.aiming ? 0.003 : 0.007);
    this.audio.shot();
    this.muzzleFlash.visible = true;
    window.setTimeout(() => { this.muzzleFlash.visible = false; }, 42);

    const spread = this.aiming ? 0.0026 : 0.0085;
    const direction = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(this.camera.quaternion)
      .add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, 0))
      .normalize();
    this.raycaster.set(this.camera.position, direction);
    this.raycaster.far = 120;
    const intersections = this.raycaster.intersectObjects([...this.blockers, ...this.enemyHitMeshes], false);
    const hit = intersections.find((entry) => {
      const enemy = entry.object.userData.enemy as EnemyRuntime | undefined;
      return !enemy || enemy.alive;
    });
    let tracerEnd = this.camera.position.clone().addScaledVector(direction, 85);
    if (hit) {
      tracerEnd = hit.point.clone();
      const enemy = hit.object.userData.enemy as EnemyRuntime | undefined;
      if (enemy?.alive) {
        const headshot = hit.object.userData.hitZone === 'head';
        this.damageEnemy(enemy, headshot ? 74 : 36, headshot);
      }
    }
    this.createTracer(this.camera.position.clone().addScaledVector(direction, 0.8), tracerEnd);
    if (weapon.magazine === 0 && weapon.reserve > 0) this.startReload();
  }

  private startReload(): void {
    const now = performance.now() / 1000;
    const weapon = this.run.player.weapon;
    if (weapon.reloading || weapon.magazine >= 30 || weapon.reserve <= 0) return;
    weapon.reloading = true;
    weapon.reloadEndsAt = now + 2.15;
    this.callbacks.onToast('正在更换弹匣');
    this.audio.tone(220, 0.07, 0.035);
  }

  private updateWeaponVisual(delta: number, now: number): void {
    if (!this.weapon) return;
    const targetX = this.aiming ? 0 : 0.27;
    const targetY = this.aiming ? -0.12 : -0.25;
    const blend = 1 - Math.pow(0.0001, delta);
    this.weapon.position.x = THREE.MathUtils.lerp(this.weapon.position.x, targetX, blend);
    this.weapon.position.y = THREE.MathUtils.lerp(this.weapon.position.y, targetY, blend);
    const moving = this.keys.has('KeyW') || this.keys.has('KeyS') || this.keys.has('KeyA') || this.keys.has('KeyD');
    this.weapon.rotation.z = moving ? Math.sin(now * 9) * 0.008 : 0;
    const fov = this.aiming ? 54 : 72;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, blend);
      this.camera.updateProjectionMatrix();
    }
  }

  private damageEnemy(enemy: EnemyRuntime, damage: number, headshot: boolean): void {
    enemy.health -= damage;
    this.callbacks.onHit(headshot);
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
      if (!enemy.alive) continue;
      const enemyEye = enemy.group.position.clone().add(new THREE.Vector3(0, 1.65, 0));
      const toPlayer = player.clone().sub(enemyEye);
      const distance = toPlayer.length();
      const direction = toPlayer.clone().normalize();
      const visible = distance < 42 && this.hasLineOfSight(enemyEye, player);
      const inCone = enemy.facing.dot(direction) > 0.35;
      const heardShot = now - this.lastShotAt < 1.3 && enemy.group.position.distanceTo(this.lastShotPosition) < 48;

      if (now >= this.combatGraceEndsAt && visible && (inCone || distance < 12 || enemy.state === 'engage')) {
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
        enemy.vehicle.maxSpeed = distance > 15 ? 2.2 : 0;
        enemy.fireCooldown -= delta;
        if (visible && distance < 42 && enemy.fireCooldown <= 0) this.enemyFire(enemy, distance);
      }
    }

    this.entityManager.update(delta);
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const previous = enemy.group.position.clone();
      enemy.group.position.set(enemy.vehicle.position.x, 0, enemy.vehicle.position.z);
      const moved = enemy.group.position.clone().sub(previous).setY(0);
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
      enemy.vehicle.maxSpeed = state === 'engage' ? 2.2 : 1.65;
      enemy.vehicle.steering.add(enemy.seek);
    }
  }

  private enemyFire(enemy: EnemyRuntime, distance: number): void {
    if (enemy.burstRemaining <= 0) enemy.burstRemaining = 3;
    enemy.burstRemaining -= 1;
    enemy.fireCooldown = enemy.burstRemaining > 0 ? 0.14 : 0.95 + Math.random() * 0.55;
    this.audio.shot(0.055);
    const origin = enemy.group.position.clone().add(new THREE.Vector3(0.3, 1.25, 0));
    const target = this.camera.position.clone();
    const accuracy = THREE.MathUtils.clamp(0.78 - distance * 0.012, 0.28, 0.68);
    const hit = Math.random() < accuracy;
    if (!hit) target.add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2 - 0.5, (Math.random() - 0.5) * 3));
    this.createTracer(origin, target);
    if (hit) this.damagePlayer(11 + Math.floor(Math.random() * 6));
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
    const next = applyDamage(this.run.player.health, this.run.player.armor, rawDamage);
    this.run.player.health = next.health;
    this.run.player.armor = next.armor;
    this.lastDamagedAt = performance.now() / 1000;
    this.run.extractionProgress = 0;
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
      if (entry.opened) continue;
      const distance = playerPosition.distanceTo(entry.position);
      if (distance < nearestDistance) {
        nearest = entry;
        nearestDistance = distance;
      }
    }
    this.nearestInteraction = nearest;
    if (nearest === 'objective') this.callbacks.onPrompt('回收加密硬盘');
    else if (nearest) this.callbacks.onPrompt(`搜索 ${nearest.item.name}`);
    else this.callbacks.onPrompt(null);
  }

  private interact(): void {
    if (!['active', 'extracting'].includes(this.run.phase)) return;
    if (this.nearestInteraction === 'objective') {
      this.takeObjective();
      return;
    }
    if (!this.nearestInteraction) return;
    const entry = this.nearestInteraction;
    const result = addInventoryItem(this.run.backpack, entry.item);
    if (!result.added) {
      this.callbacks.onToast('背包空间不足', 'danger');
      return;
    }
    this.run.backpack = result.items;
    entry.opened = true;
    entry.mesh.visible = false;
    this.nearestInteraction = null;
    this.callbacks.onPrompt(null);
    this.callbacks.onToast(`已取得 ${entry.item.name}`);
    this.audio.tone(entry.item.rarity === 'valuable' ? 760 : 520, 0.09, 0.04);
  }

  private takeObjective(): void {
    if (this.run.hasObjective) return;
    this.run.hasObjective = true;
    this.objectiveCase.visible = false;
    this.run.objectiveText = '携带加密硬盘，前往东南撤离区';
    this.callbacks.onPrompt(null);
    this.callbacks.onToast('主目标已回收 · 撤离点开放');
    this.audio.tone(720, 0.18, 0.055);
  }

  private updateExtraction(delta: number, now: number): void {
    const position = this.camera.position;
    const distance = Math.hypot(position.x - 45, position.z + 42);
    if (distance > 5.5) {
      this.run.extractionProgress = 0;
      if (this.run.phase === 'extracting') this.run.phase = 'active';
      if (this.run.hasObjective) this.run.objectiveText = '携带加密硬盘，前往东南撤离区';
      return;
    }
    if (!canExtract(this.run)) {
      this.callbacks.onPrompt('需要加密硬盘才能撤离');
      return;
    }
    if (now - this.lastDamagedAt < 0.8) {
      this.run.extractionProgress = 0;
      return;
    }
    this.run.phase = 'extracting';
    this.run.extractionProgress += delta;
    this.run.objectiveText = '保持位置，等待撤离信号确认';
    if (this.run.extractionProgress >= 6) this.completeRun();
  }

  private completeRun(): void {
    if (this.run.phase === 'success') return;
    this.run.phase = 'success';
    this.callbacks.onUpdate(this.run);
    this.callbacks.onDeploying(false);
    this.callbacks.onPrompt(null);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.audio.tone(840, 0.35, 0.06);
    this.callbacks.onEnd(this.run, true);
  }

  private failRun(message: string): void {
    if (this.run.phase === 'failed' || this.run.phase === 'success') return;
    this.run.phase = 'failed';
    this.run.objectiveText = message;
    this.callbacks.onUpdate(this.run);
    this.callbacks.onDeploying(false);
    this.callbacks.onPrompt(null);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.callbacks.onEnd(this.run, false);
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
    this.playerBody.setTranslation({ x, y: 0.9, z }, true);
    this.playerBody.setNextKinematicTranslation({ x, y: 0.9, z });
    this.camera.position.set(x, 1.52, z);
  }
}
