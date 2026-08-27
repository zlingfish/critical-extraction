import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import * as YUKA from 'yuka';
import { addInventoryItem, completeReload, consumeKeyUse, createRunState, discardInventoryItem, nextLootRevealCount, reorderInventoryItems, sortInventoryItems, transferInventoryItem } from './domain';
import { lootPoolForContainer, LOOT_POOLS } from './loot';
import type { AmmoLevel, BodyPart, EnemyState, InventoryItem, MedicalTreatment, RunState, WeaponBuildEffects, WeaponState } from './types';
import { aimSwayMultiplier, applyBodyInjury, moveItemFromSecureContainer, moveItemToSecureContainer, movementMultiplier, resolveBallisticHit, wearDurability } from './survival-systems';
import {
  closestPointOnSegment,
  ENEMY_WEAPON_CONFIGS,
  getEnemyDifficultyBehavior,
  getEnemySuppressionResponse,
  selectEnemyTactic,
  shouldAlertAlly,
  shouldPlayBulletWhiz,
  updateEnemyAttackWarning,
  updateEnemyPerception,
} from './enemy-ai';
import type { EnemyAttackWarningState, EnemyPerceptionState, EnemyTactic, EnemyWeaponId } from './enemy-ai';
import { createDefaultSettings } from './settings';
import type { GameAction, GameSettings, QualityLevel } from './settings';
import { RECOIL_AMPLITUDE, resolveAimSpread, resolveDamageAtDistance, resolvePelletDamage, resolveRecoilStep, resolveReloadDuration, resolveWeaponClearance, WEAPON_FEEL_PROFILES } from './weapon-feel';
import type { ReloadStyle } from './weapon-feel';
import { createRecoveredEnemyEquipment } from './enemy-gear';
import type { EnemyArmorClass } from './enemy-gear';
import { gameModeDefinition, isObjectiveCarryMode } from './game-modes';
import type { GameModeId } from './game-modes';
import { backpackSpeedMultiplier, rareLootSignalRadius } from './loot-risk';
import {
  advanceExtractionCondition,
  advanceTaskProgress,
  createOperationScenario,
  createTaskProgress,
  updateTaskClock,
} from './operation-events';
import type { ExtractionConditionProgress, OperationScenario, TaskProgress } from './operation-events';
import {
  DEFAULT_CHALLENGES,
  createChallengeProgress,
  createExtractItemChallenge,
  dailyChallengeIndex,
  updateChallengeSet,
} from './run-challenges';
import type { ChallengeDefinition, ChallengeProgress } from './run-challenges';
import { getThreatEscalation } from './threat-escalation';
import type { ThreatEscalation } from './threat-escalation';
import {
  applyShieldDamageReduction,
  calculateMedicHeal,
  getCaptainSupportResult,
  getEnemyRoleConfig,
  selectEnemyRole,
  shouldAssaultAdvance,
} from './enemy-roles';
import type { EnemyRoleId } from './enemy-roles';
import { getBossCombatPhase, getBossCombatTuning, selectBossTactic } from './boss-combat';
import { selectOperationLayout } from './operation-layouts';
import { ADMIN_SECRET_CARD, ADMIN_SECRET_CARD_ID } from './keycards';
import { resolveFactionDamage, selectFactionTarget } from './faction-combat';
import type { EnemyFaction } from './faction-combat';
import { advanceShortcutGate, createShortcutGate, unlockShortcutGate } from './world-shortcuts';
import type { ShortcutGateState } from './world-shortcuts';
import {
  ADRENALINE_COOLDOWN,
  ADRENALINE_DURATION,
  ADRENALINE_SPEED_MULTIPLIER,
  ADRENALINE_TOTAL_HEALING,
  RUN_COOLDOWN,
  RUN_DURATION,
  RUN_SPEED_MULTIPLIER,
  SMOKE_COOLDOWN,
  SMOKE_DURATION,
  SMOKE_RADIUS,
  abilitySecondsRemaining,
  applyAdrenalineHealing,
  isAbilityReady,
  lineSegmentIntersectsSphere,
} from './abilities';

type WeaponId = 'rifle' | 'smg' | 'shotgun';
export type MapId = 'harbor' | 'radar' | 'refinery' | 'administration' | 'reservoir';
export type DifficultyId = 'recruit' | 'standard' | 'veteran';
export type BossMode = 'single' | 'double';
export type { GameModeId } from './game-modes';
type AcousticSpace = 'outdoor' | 'indoor' | 'underground';

export interface WeaponView {
  id: WeaponId;
  name: string;
  slot: number;
}

export interface AbilityView {
  smokeCooldown: number;
  smokeActive: number;
  adrenalineCooldown: number;
  adrenalineActive: number;
  runCooldown: number;
  runActive: number;
}

export interface OperationStatusView {
  event: { title: string; description: string; active: boolean; remainingSeconds: number };
  task: { title: string; target: string; progress: number; required: number; completed: boolean; failed: boolean };
  extraction: { title: string; target: string; completed: boolean };
  risk: { label: string; high: boolean };
  threat: { label: string; level: number; progress: number };
  challenge: { title: string; description: string; progress: number; target: number; completed: boolean; failed: boolean };
}

export interface FieldMarketView {
  visible: boolean;
  itemCount: number;
  ammo: number;
  medkits: number;
  hasExtractionIntel: boolean;
}

export interface MiniMapView {
  mapId?: MapId;
  mapName: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  player: { x: number; z: number; yaw: number };
  objective: { x: number; z: number; active: boolean };
  extraction: { x: number; z: number; active: boolean; revealed?: boolean };
  enemies: Array<{ x: number; z: number; elite: boolean; boss: boolean }>;
  checkpoint?: { x: number; z: number; active: boolean } | null;
  target?: { x: number; z: number; label: string; type: 'boss' | 'task' | 'extract' };
  tasks?: MissionTaskView[];
  highValueTask?: HighValueTaskView | null;
  floorLabel?: string;
  secretRoom?: { x: number; z: number; label: string; floor: string; unlocked: boolean } | null;
}

export interface HighValueTaskView {
  title: string;
  stage: 'clear' | 'collect' | 'deliver' | 'complete';
  target: { x: number; z: number; label: string } | null;
  reward: { name: string; value: number };
  steps: MissionTaskView[];
}

export interface TacticalMapView extends MiniMapView {
  mapId: MapId;
  checkpoint: { x: number; z: number; active: boolean } | null;
  target: { x: number; z: number; label: string; type: 'boss' | 'task' | 'extract' };
  bonusTarget: { x: number; z: number; label: string } | null;
  tasks: MissionTaskView[];
  riskZones: Array<{ x: number; z: number; radius: number; level: 'high' }>;
}

interface WeaponConfig extends WeaponView {
  magazineSize: number;
  reserve: number;
  fireInterval: number;
  damage: number;
  headshotDamage: number;
  pellets: number;
  damageIsPerShot?: boolean;
  hipSpread: number;
  aimSpread: number;
  reloadDuration: number;
  recoil: number;
  color: string;
  receiverScale: number;
  barrelScale: number;
  muzzleZ: number;
}

interface GameCallbacks {
  onUpdate: (run: RunState) => void;
  onPrompt: (message: string | null) => void;
  onToast: (message: string, tone?: 'info' | 'danger') => void;
  onHit: (zone: EnemyHitZone) => void;
  onDamage: () => void;
  onCompass: (heading: string) => void;
  onMiniMap: (state: TacticalMapView) => void;
  onAiming: (active: boolean) => void;
  onLootSearch: (state: LootSearchView | null) => void;
  onWeaponChange: (weapon: WeaponView) => void;
  onControlCapture: (active: boolean) => void;
  onControlStatus: (message: string) => void;
  onBossUpdate: (state: { name: string; health: number; maxHealth: number; enraged?: boolean } | null) => void;
  onAbilities?: (state: AbilityView) => void;
  onOperationStatus?: (state: OperationStatusView) => void;
  onFieldMarket?: (state: FieldMarketView | null) => void;
  onSpendCredits?: (amount: number) => boolean;
  onDeploying: (active: boolean) => void;
  onPause: () => void;
  onEnd: (run: RunState, successful: boolean) => void;
  onFatalError: (error: unknown) => void;
}

type EnemyHitZone = 'head' | 'armor' | 'body';
type ImpactSurface = 'metal' | 'wood' | 'dirt';

export interface MissionTaskView {
  id: string;
  label: string;
  status: 'complete' | 'active' | 'locked';
}

type HighValueTaskStage = 'inactive' | 'clear' | 'collect' | 'deliver' | 'complete';

interface HighValueTaskConfig {
  title: string;
  driveLabel: string;
  drive: { x: number; y: number; z: number };
  radio: { x: number; y: number; z: number };
}

interface LootRuntime {
  mesh: THREE.Group;
  position: THREE.Vector3;
  operationId: MapId;
  tier: ContainerTier;
  containerName: string;
  items: InventoryItem[];
  equipment: InventoryItem[];
  opened: boolean;
  source: 'container' | 'corpse';
  capacity: number;
  boss: boolean;
}

interface EnemyRuntime {
  group: THREE.Group;
  torso: THREE.Group;
  headRig: THREE.Group;
  body: THREE.Mesh;
  armor: THREE.Mesh;
  head: THREE.Mesh;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  weapon: THREE.Group;
  weaponId: EnemyWeaponId;
  role: EnemyRoleId;
  faction: EnemyFaction;
  factionTarget: EnemyRuntime | null;
  factionFireCooldown: number;
  lastRoleActionAt: number;
  vehicle: YUKA.Vehicle;
  path: YUKA.Path;
  seek: YUKA.SeekBehavior;
  state: EnemyState;
  health: number;
  home: THREE.Vector3;
  facing: THREE.Vector3;
  lastSeen: THREE.Vector3;
  perception: EnemyPerceptionState;
  lastStateChange: number;
  fireCooldown: number;
  burstRemaining: number;
  ammo: number;
  reloading: boolean;
  reloadEndsAt: number;
  hurtEndsAt: number;
  lastFiredAt: number;
  deathStartedAt: number;
  deathSide: number;
  tactic: EnemyTactic;
  tacticalTarget: THREE.Vector3;
  nextTacticAt: number;
  flankSide: number;
  lastCallAt: number;
  attackWarning: EnemyAttackWarningState;
  lastSuppressedAt: number;
  searchCenter: THREE.Vector3;
  searchStep: number;
  searchPauseUntil: number;
  searchEndsAt: number;
  alive: boolean;
  pendingReinforcement: boolean;
  elite: boolean;
  boss: boolean;
  bossReward: InventoryItem | null;
  name: string;
  maxHealth: number;
  armorDurability: number;
  armorMaxDurability: number;
  armorBroken: boolean;
  floorY: number;
  enraged: boolean;
  lastHitAt: number;
  walkPhase: number;
  movementBlend: number;
  lastAnimationPosition: THREE.Vector3;
  alertLight: THREE.PointLight;
  muzzleLight: THREE.PointLight;
  trainingTarget: boolean;
  trainingDistance: number;
  trainingArmorLevel: number;
  trainingResetAt: number;
}

interface TracerRuntime {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

interface SmokeParticle {
  offset: THREE.Vector3;
  scale: number;
  drift: number;
}

interface SmokeRuntime {
  mesh: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  position: THREE.Vector3;
  particles: SmokeParticle[];
  startedAt: number;
  endsAt: number;
  radius: number;
}

interface ShellRuntime {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

interface BloodParticleRuntime {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface ImpactParticleRuntime {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
  grow: number;
}

interface DestructibleRuntime {
  mesh: THREE.Mesh;
  collider: RAPIER.Collider | null;
  kind: 'glass' | 'barrel' | 'light' | 'prop';
  operationId: MapId;
  health: number;
  maxHealth: number;
  destroyed: boolean;
  linkedLight?: THREE.PointLight;
}

export interface LootSearchView {
  items: InventoryItem[];
  equipment: InventoryItem[];
  containerName: string;
  phase: 'searching' | 'revealing' | 'revealed';
  progress: number;
  message: string;
  source: 'container' | 'corpse';
  capacity: number;
  boss: boolean;
  revealedSlots: number;
  justRevealedSlot: number | null;
}

interface OperationConfig {
  id: MapId;
  name: string;
  objectiveText: string;
  spawn: { x: number; z: number };
  objective: { x: number; z: number };
  extraction: { x: number; z: number };
  enemies: Array<[number, number, boolean?]>;
  loot: Array<[number, number, ContainerTier, number?]>;
}

interface BossProfile {
  name: string;
  reward: InventoryItem;
}

type ContainerTier =
  | 'bag'
  | 'briefcase'
  | 'toolbox'
  | 'medical'
  | 'computer'
  | 'server'
  | 'ammo'
  | 'locker'
  | 'case'
  | 'military'
  | 'weapon'
  | 'safe'
  | 'hidden'
  | 'vault';

interface LootSearchRuntime {
  entry: LootRuntime;
  startedAt: number;
  duration: number;
  revealed: boolean;
  revealedSlots: number;
  phase: LootSearchView['phase'];
  nextRevealAt: number;
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
  private lastVoiceAt = -100;
  private lastWhizAt = -100;
  private volumeScale = 0.65;

  setListener(position: THREE.Vector3, forward: THREE.Vector3): void {
    if (!this.context) return;
    const listener = this.context.listener;
    const now = this.context.currentTime;
    if (listener.positionX) {
      listener.positionX.setValueAtTime(position.x, now);
      listener.positionY.setValueAtTime(position.y, now);
      listener.positionZ.setValueAtTime(position.z, now);
      listener.forwardX.setValueAtTime(forward.x, now);
      listener.forwardY.setValueAtTime(forward.y, now);
      listener.forwardZ.setValueAtTime(forward.z, now);
      listener.upX.setValueAtTime(0, now);
      listener.upY.setValueAtTime(1, now);
      listener.upZ.setValueAtTime(0, now);
    } else {
      listener.setPosition(position.x, position.y, position.z);
      listener.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  setVolume(value: number): void {
    this.volumeScale = THREE.MathUtils.clamp(value, 0, 1);
  }

  unlock(): void {
    if (!this.context) {
      this.context = new AudioContext();
      const length = Math.floor(this.context.sampleRate * 0.55);
      this.noiseBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) {
        data[index] = Math.random() * 2 - 1;
      }
    }
    void this.context.resume();
  }

  shot(volume = 0.18, position?: THREE.Vector3, space: AcousticSpace = 'outdoor'): void {
    if (!this.context || !this.noiseBuffer) return;
    const context = this.context;
    const noiseBuffer = this.noiseBuffer;
    const now = context.currentTime;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-18, now);
    compressor.knee.setValueAtTime(8, now);
    compressor.ratio.setValueAtTime(5, now);
    compressor.attack.setValueAtTime(0.002, now);
    compressor.release.setValueAtTime(0.16, now);

    const spatial = position
      ? this.connectSpatial(compressor, position, space === 'underground' ? 145 : 110)
      : null;
    if (!spatial) compressor.connect(context.destination);
    const output = spatial ?? context.destination;
    const reflectionNodes = this.connectShotReflections(compressor, output, space);

    const addNoiseLayer = (
      type: BiquadFilterType,
      startOffset: number,
      duration: number,
      startFrequency: number,
      endFrequency: number,
      amount: number,
      q = 0.7,
    ): void => {
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      const startsAt = now + startOffset;
      source.buffer = noiseBuffer;
      filter.type = type;
      filter.Q.setValueAtTime(q, startsAt);
      filter.frequency.setValueAtTime(startFrequency, startsAt);
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), startsAt + duration);
      gain.gain.setValueAtTime(Math.max(0.001, volume * this.volumeScale * amount), startsAt);
      gain.gain.exponentialRampToValueAtTime(0.001, startsAt + duration);
      source.connect(filter).connect(gain).connect(compressor);
      source.onended = () => {
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
      };
      source.start(startsAt);
      source.stop(startsAt + duration + 0.015);
    };

    // Three different frequency bands make the shot read as a sharp crack,
    // a mechanical body, and a low pressure wave instead of a single click.
    addNoiseLayer('highpass', 0, 0.055, 2700, 1100, 0.76, 0.85);
    addNoiseLayer('bandpass', 0.004, 0.16, 980, 330, 0.82, 0.72);
    addNoiseLayer('lowpass', 0, 0.24, 1900, 170, 1.18, 0.6);
    if (space === 'indoor') addNoiseLayer('bandpass', 0.025, 0.32, 1250, 210, 0.24, 0.58);
    else if (space === 'underground') addNoiseLayer('lowpass', 0.035, 0.48, 1050, 110, 0.3, 0.55);
    else addNoiseLayer('bandpass', 0.035, 0.4, 820, 230, 0.16, 0.5);

    const pressure = context.createOscillator();
    const pressureGain = context.createGain();
    pressure.type = 'sine';
    pressure.frequency.setValueAtTime(space === 'underground' ? 82 : 94, now);
    pressure.frequency.exponentialRampToValueAtTime(44, now + 0.15);
    pressureGain.gain.setValueAtTime(Math.max(0.001, volume * this.volumeScale * 0.48), now);
    pressureGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    pressure.connect(pressureGain).connect(compressor);
    pressure.onended = () => {
      pressure.disconnect();
      pressureGain.disconnect();
    };
    pressure.start(now);
    pressure.stop(now + 0.17);

    const cleanupDelay = space === 'underground' ? 1500 : space === 'indoor' ? 1150 : 900;
    globalThis.setTimeout(() => {
      reflectionNodes.forEach((node) => node.disconnect());
      compressor.disconnect();
      spatial?.disconnect();
    }, cleanupDelay);
  }

  distantShot(position: THREE.Vector3): void {
    this.shot(0.055 + Math.random() * 0.035, position, 'outdoor');
    this.toneAt(72 + Math.random() * 26, 0.28, 0.018, position, 220);
  }

  bulletWhiz(position: THREE.Vector3, distance: number): void {
    if (!this.context || !this.noiseBuffer) return;
    const context = this.context;
    const now = context.currentTime;
    if (now - this.lastWhizAt < 0.085) return;
    this.lastWhizAt = now;
    const strength = THREE.MathUtils.clamp(1 - (distance - 0.45) / 2.35, 0.25, 1);
    const bus = context.createGain();
    const panner = this.connectSpatial(bus, position, 12, 0.4, 0.45);
    if (!panner) bus.connect(context.destination);

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = this.noiseBuffer;
    source.playbackRate.setValueAtTime(1.35, now);
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(1.5, now);
    filter.frequency.setValueAtTime(7200, now);
    filter.frequency.exponentialRampToValueAtTime(2600, now + 0.12);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime((0.055 + strength * 0.06) * this.volumeScale, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    source.connect(filter).connect(gain).connect(bus);

    const whistle = context.createOscillator();
    const whistleGain = context.createGain();
    whistle.type = 'sawtooth';
    whistle.frequency.setValueAtTime(3400 + strength * 900, now);
    whistle.frequency.exponentialRampToValueAtTime(850, now + 0.1);
    whistleGain.gain.setValueAtTime(0.001, now);
    whistleGain.gain.exponentialRampToValueAtTime((0.009 + strength * 0.014) * this.volumeScale, now + 0.004);
    whistleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.105);
    whistle.connect(whistleGain).connect(bus);

    source.start(now);
    source.stop(now + 0.14);
    whistle.start(now);
    whistle.stop(now + 0.11);
    globalThis.setTimeout(() => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      whistle.disconnect();
      whistleGain.disconnect();
      bus.disconnect();
      panner?.disconnect();
    }, 220);
  }

  private connectShotReflections(node: AudioNode, output: AudioNode, space: AcousticSpace): AudioNode[] {
    if (!this.context) return [];
    const taps = space === 'underground'
      ? [[0.07, 0.32, 1500], [0.16, 0.23, 900], [0.29, 0.14, 520]]
      : space === 'indoor'
        ? [[0.045, 0.27, 1900], [0.095, 0.18, 1200], [0.165, 0.1, 720]]
        : [[0.105, 0.09, 1050], [0.245, 0.035, 620]];
    const nodes: AudioNode[] = [];
    for (const [delaySeconds, amount, cutoff] of taps) {
      const delay = this.context.createDelay(0.6);
      const filter = this.context.createBiquadFilter();
      const wet = this.context.createGain();
      delay.delayTime.value = delaySeconds;
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      wet.gain.value = amount;
      node.connect(delay).connect(filter).connect(wet).connect(output);
      nodes.push(delay, filter, wet);
    }
    return nodes;
  }

  pipeEcho(position: THREE.Vector3): void {
    this.toneAt(118 + Math.random() * 45, 0.42, 0.025, position, 65, true);
  }

  environmentPulse(position: THREE.Vector3, underground: boolean): void {
    this.spatialNoise(
      underground ? 0.016 : 0.012,
      underground ? 1.25 : 1.8,
      underground ? 310 : 720,
      position,
      underground ? 'lowpass' : 'bandpass',
      underground,
    );
  }

  extractionSignal(position: THREE.Vector3): void {
    this.toneAt(168, 0.34, 0.032, position, 220);
    this.toneAt(252, 0.18, 0.018, position, 220);
  }

  destructibleExplosion(position: THREE.Vector3): void {
    this.shot(0.24, position, 'outdoor');
    this.toneAt(52, 0.48, 0.14, position, 130);
  }

  private connectSpatial(
    node: AudioNode,
    position: THREE.Vector3,
    maxDistance: number,
    refDistance = 2,
    rolloffFactor = 1.15,
  ): PannerNode | null {
    if (!this.context) return null;
    const panner = this.context.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = refDistance;
    panner.maxDistance = maxDistance;
    panner.rolloffFactor = rolloffFactor;
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;
    node.connect(panner).connect(this.context.destination);
    return panner;
  }

  private connectEcho(node: AudioNode, delaySeconds: number, amount: number): void {
    if (!this.context) return;
    const delay = this.context.createDelay(0.8);
    const wet = this.context.createGain();
    delay.delayTime.value = delaySeconds;
    wet.gain.value = amount;
    node.connect(delay);
    delay.connect(wet).connect(this.context.destination);
  }

  private spatialNoise(
    volume: number,
    duration: number,
    cutoff: number,
    position: THREE.Vector3,
    type: BiquadFilterType,
    echo: boolean,
  ): void {
    if (!this.context || !this.noiseBuffer) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    source.loop = duration > this.noiseBuffer.duration;
    filter.type = type;
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume * this.volumeScale), now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain);
    const panner = this.connectSpatial(gain, position, echo ? 65 : 90);
    if (echo) this.connectEcho(gain, 0.18, 0.13);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      panner?.disconnect();
    };
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  private toneAt(
    frequency: number,
    duration: number,
    volume: number,
    position: THREE.Vector3,
    maxDistance: number,
    echo = false,
  ): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume * this.volumeScale, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain);
    const panner = this.connectSpatial(gain, position, maxDistance);
    if (echo) this.connectEcho(gain, 0.16, 0.16);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      panner?.disconnect();
    };
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  private noiseBurst(volume: number, duration: number, cutoff: number, type: BiquadFilterType = 'lowpass'): void {
    if (!this.context || !this.noiseBuffer) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = type;
    filter.frequency.setValueAtTime(cutoff, now);
    gain.gain.setValueAtTime(volume * this.volumeScale, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(this.context.destination);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  footstep(kind: 'walk' | 'sprint' | 'crouch', underground = false): void {
    const volume = kind === 'sprint' ? 0.075 : kind === 'crouch' ? 0.018 : 0.042;
    this.noiseBurst(volume, kind === 'sprint' ? 0.13 : 0.1, kind === 'crouch' ? 420 : 760);
    this.tone(kind === 'sprint' ? 92 : 74, 0.055, kind === 'crouch' ? 0.012 : 0.018);
    if (underground && kind !== 'crouch') this.tone(kind === 'sprint' ? 142 : 126, 0.12, 0.008);
  }

  landing(intensity: number): void {
    const strength = THREE.MathUtils.clamp(intensity, 0.25, 1);
    this.noiseBurst(0.045 + strength * 0.09, 0.18, 480);
    this.tone(58, 0.12, 0.025 + strength * 0.035);
  }

  breath(intensity: number): void {
    const strength = THREE.MathUtils.clamp(intensity, 0.2, 1);
    this.noiseBurst(0.012 + strength * 0.018, 0.42, 900, 'bandpass');
  }

  smokeDeploy(position: THREE.Vector3): void {
    this.spatialNoise(0.07, 0.7, 980, position, 'bandpass', false);
    this.toneAt(145, 0.18, 0.035, position, 35);
  }

  adrenaline(): void {
    this.noiseBurst(0.035, 0.28, 1450, 'bandpass');
    this.tone(290, 0.07, 0.028);
    globalThis.setTimeout(() => this.tone(520, 0.11, 0.032), 90);
  }

  impact(zone: EnemyHitZone): void {
    if (zone === 'head') {
      this.noiseBurst(0.072, 0.085, 1380, 'bandpass');
      this.tone(940, 0.052, 0.036);
      return;
    }
    if (zone === 'armor') {
      this.noiseBurst(0.062, 0.072, 2100, 'highpass');
      this.tone(238, 0.065, 0.032);
      this.tone(1640, 0.028, 0.017);
      return;
    }
    this.noiseBurst(0.052, 0.09, 690, 'bandpass');
    this.tone(112, 0.072, 0.025);
  }

  armorBreak(position: THREE.Vector3): void {
    this.noiseBurst(0.11, 0.15, 2450, 'highpass');
    this.toneAt(185, 0.13, 0.085, position, 42);
    this.toneAt(1180, 0.06, 0.048, position, 42);
  }

  surfaceImpact(surface: ImpactSurface, position: THREE.Vector3): void {
    if (surface === 'metal') {
      this.toneAt(1380 + Math.random() * 520, 0.045, 0.046, position, 36);
      this.toneAt(260, 0.065, 0.025, position, 32);
      return;
    }
    if (surface === 'wood') {
      this.toneAt(185 + Math.random() * 55, 0.075, 0.042, position, 28);
      this.noiseBurst(0.025, 0.065, 820, 'bandpass');
      return;
    }
    this.toneAt(76, 0.075, 0.022, position, 24);
    this.noiseBurst(0.024, 0.11, 430, 'lowpass');
  }

  weaponAction(action: 'reload-out' | 'reload-in' | 'switch' | 'inspect'): void {
    if (action === 'reload-out') {
      this.noiseBurst(0.026, 0.06, 1450, 'highpass');
      this.tone(185, 0.045, 0.018);
    } else if (action === 'reload-in') {
      this.noiseBurst(0.038, 0.07, 1750, 'highpass');
      this.tone(310, 0.055, 0.025);
    } else if (action === 'switch') {
      this.noiseBurst(0.025, 0.09, 520, 'lowpass');
    } else {
      this.noiseBurst(0.014, 0.07, 950, 'bandpass');
      this.tone(260, 0.04, 0.012);
    }
  }

  tone(frequency: number, duration: number, volume: number): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume * this.volumeScale, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  voice(line: string, distance = 0): void {
    const now = performance.now() / 1000;
    if (now - this.lastVoiceAt < 0.75) return;
    this.lastVoiceAt = now;
    const speech = globalThis.speechSynthesis;
    const Utterance = globalThis.SpeechSynthesisUtterance;
    if (!speech || !Utterance) {
      this.tone(110, 0.24, 0.08);
      return;
    }
    const utterance = new Utterance(line);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.16;
    utterance.pitch = 0.72;
    utterance.volume = THREE.MathUtils.clamp((0.86 - distance * 0.012) * this.volumeScale, 0, 1);
    speech.speak(utterance);
  }

  dispose(): void {
    globalThis.speechSynthesis?.cancel();
    if (this.context) void this.context.close();
    this.context = null;
    this.noiseBuffer = null;
  }
}

const OPERATIONS: Record<MapId, OperationConfig> = {
  harbor: {
    id: 'harbor', name: '九号物流港', objectiveText: '潜入主仓库，取得加密硬盘',
    spawn: { x: 0, z: 66 }, objective: { x: -18, z: -16 }, extraction: { x: 44, z: -70 },
    enemies: [[-8, 35], [18, 25], [32, 2], [-27, -3], [-14, -18, true], [18, -24], [36, -34, true], [-32, 27], [3, -48], [49, 18]],
    loot: [[-38,34,'case'],[-20,26,'bag'],[9,28,'case'],[28,15,'military'],[-29,-15,'case'],[-9,-20,'safe'],[8,-7,'bag'],[24,-15,'case'],[39,-7,'military'],[30,-38,'case'],[-45,5,'bag'],[47,28,'military'],[5,48,'bag'],[-12,52,'case'],[43,-31,'safe'],[17,-47,'case']],
  },
  radar: {
    id: 'radar', name: '长风雷达站', objectiveText: '进入雷达中心，夺取频谱记录器',
    spawn: { x: -92, z: 58 }, objective: { x: -72, z: -6 }, extraction: { x: -92, z: -66 },
    enemies: [[-82,42],[-66,35],[-102,15],[-70,4,true],[-84,-5],[-62,-28],[-91,-42],[-72,-52,true],[-51,-8],[-68,45],[-99,-10]],
    loot: [[-96,48,'bag'],[-78,47,'case'],[-66,40,'military'],[-102,25,'case'],[-73,18,'bag'],[-55,8,'case'],[-91,-8,'military'],[-72,-5,'safe'],[-56,-25,'case'],[-94,-35,'bag'],[-78,-42,'military'],[-60,-51,'case'],[-92,-57,'case'],[-55,42,'safe'],[-47,-6,'bag'],[-68,2,'case'],[-86,8,'bag'],[-53,-43,'military']],
  },
  refinery: {
    id: 'refinery', name: '赤湾炼化区', objectiveText: '搜索控制楼，取得反应堆密钥',
    spawn: { x: 91, z: 62 }, objective: { x: 72, z: 1 }, extraction: { x: 94, z: -68 },
    enemies: [[85,48],[68,42],[108,24],[72,14,true],[88,-5],[64,0],[96,-30],[77,-42,true],[58,-50],[103,1],[51,22],[91,-55]],
    loot: [[99,51,'bag'],[80,48,'case'],[61,40,'military'],[108,36,'case'],[76,24,'bag'],[55,15,'case'],[92,5,'military'],[72,1,'safe'],[55,-17,'case'],[98,-23,'bag'],[79,-31,'military'],[61,-40,'case'],[98,-48,'case'],[50,42,'safe'],[49,-3,'bag'],[69,7,'case'],[86,16,'bag'],[56,-55,'military'],[88,-58,'safe'],[104,38,'case']],
  },
  administration: {
    id: 'administration', name: '行政辖区', objectiveText: '深入行政主楼，击败守卫首领并取得中央档案',
    spawn: { x: 165, z: 149 }, objective: { x: 165, z: -37 }, extraction: { x: 218, z: 145 },
    enemies: [[165,132],[122,139],[207,132],[143,112],[190,114],[165,73],[121,61],[209,58],[165,45],[143,27],[187,27],[140,5],[190,4],[148,-18],[182,-18],[111,-68],[219,-68],[126,-121],[204,-125],[165,-137],[137,-38],[193,-38,true],[165,-27,true]],
    loot: [[122,136,'computer'],[207,132,'locker'],[142,119,'hidden'],[214,113,'case'],[123,-128,'briefcase'],[207,-126,'server'],[165,-141,'weapon'],[140,-112,'hidden'],[121,57,'briefcase'],[209,53,'case'],[111,-70,'computer'],[219,-70,'locker'],[151,29,'military'],[179,29,'military'],[137,18,'case'],[193,18,'case'],[146,4,'safe'],[184,4,'safe'],[138,-12,'military'],[192,-12,'military'],[151,-26,'safe'],[179,-26,'safe'],[142,-40,'vault'],[188,-40,'vault'],[160,-42,'vault'],[170,-42,'vault'],[165,15,'military'],[165,-8,'safe'],[128,-4,'safe',4.55],[136,-32,'military',4.55],[194,-4,'safe',4.55],[202,-32,'military',4.55],[127,-44,'safe',4.55],[132,-44,'weapon',4.55],[137,-44,'vault',4.55]],
  },
  reservoir: {
    id: 'reservoir', name: '黑峡水库', objectiveText: '穿越水利枢纽，取得地下主控芯片',
    spawn: { x: 280, z: 116 }, objective: { x: 467, z: -72 }, extraction: { x: 516, z: 102 },
    enemies: [
      [278,92],[300,66],[324,90],[338,43],[365,88],[420,60],[410,86],[430,54],[462,88],
      [490,62],[505,20],[472,-4],[440,-20],[430,-36],[425,-61,true],[420,-86],[459,-77,true],[498,-66],
      [518,-24],[528,42],[325,-7],[310,-34],
    ],
    loot: [
      [266,104,'bag'],[278,83,'toolbox'],[294,68,'briefcase'],[305,92,'medical'],[319,58,'case'],
      [330,96,'ammo'],[343,42,'locker'],[354,88,'computer'],[369,95,'military'],[382,88,'bag'],
      [394,90,'server'],[407,101,'weapon'],[421,51,'case'],[437,93,'medical'],[452,69,'briefcase'],
      [468,91,'military'],[487,66,'ammo'],[507,93,'hidden'],[520,58,'toolbox'],[509,31,'case'],
      [486,15,'computer'],[461,4,'safe'],[439,-15,'locker'],[430,-36,'medical'],[389,-82,'case'],
      [325,-55,'hidden'],[397,-82,'weapon'],[425,-91,'military'],[472,-68,'safe'],[476,-87,'server'],
      [501,-68,'military'],[522,-42,'ammo'],[535,-8,'bag'],[326,-17,'toolbox'],[316,-39,'case'],
      [292,-12,'hidden'],[320,15,'medical'],[379,104,'briefcase'],
      [322,78,'server',-3.35],[362,78,'toolbox',-3.35],[402,78,'weapon',-3.35],[442,78,'safe',-3.35],
      [310,42,'toolbox',-3.35],[324,42,'server',-3.35],[390,42,'medical',-3.35],[399,42,'hidden',-3.35],
    ],
  },
};

const BOSS_PROFILES: Record<MapId, readonly [BossProfile, BossProfile]> = {
  harbor: [
    {
      name: '港区监工「铁锚」',
      reward: { id: 'iron-anchor-pass', name: '铁锚通行证', kind: 'intel', rarity: 'red', value: 16000, quantity: 1, description: '港区封锁线的最高权限凭证。' },
    },
    {
      name: '走私头目「灰鲨」',
      reward: { id: 'grey-shark-ledger', name: '灰鲨密账', kind: 'intel', rarity: 'red', value: 18000, quantity: 1, description: '记录港区秘密货运路线的加密账本。' },
    },
  ],
  radar: [
    {
      name: '雷达指挥官「天线」',
      reward: { id: 'antenna-command-key', name: '阵列指挥密钥', kind: 'electronics', rarity: 'red', value: 17000, quantity: 1, description: '可接管雷达阵列的指挥密钥。' },
    },
    {
      name: '山地猎手「白噪」',
      reward: { id: 'white-noise-module', name: '白噪干扰模块', kind: 'electronics', rarity: 'red', value: 19000, quantity: 1, description: '经过特殊改装的宽频干扰装置。' },
    },
  ],
  refinery: [
    {
      name: '炼化主管「赤炉」',
      reward: { id: 'red-furnace-seal', name: '赤炉安全印章', kind: 'intel', rarity: 'red', value: 18000, quantity: 1, description: '炼化区核心设备的安全认证印章。' },
    },
    {
      name: '应急队长「火墙」',
      reward: { id: 'firewall-controller', name: '防爆控制器', kind: 'electronics', rarity: 'red', value: 20000, quantity: 1, description: '控制炼化区防爆隔离门的工业终端。' },
    },
  ],
  administration: [
    {
      name: '特勤长「铁幕」',
      reward: { id: 'iron-curtain-token', name: '特勤授权令牌', kind: 'intel', rarity: 'red', value: 21000, quantity: 1, description: '行政辖区特勤部队的调度凭证。' },
    },
    {
      name: '辖区总长「壁垒」',
      reward: { id: 'warden-access-card', name: '辖区总长权限卡', kind: 'intel', rarity: 'red', value: 22000, quantity: 1, description: '「壁垒」随身携带的中央档案访问凭证。' },
    },
  ],
  reservoir: [
    {
      name: '坝区守卫「洪峰」',
      reward: { id: 'flood-crest-key', name: '坝体应急密钥', kind: 'electronics', rarity: 'red', value: 20000, quantity: 1, description: '控制坝体应急闸门的加密密钥。' },
    },
    {
      name: '管道猎手「暗流」',
      reward: { id: 'undercurrent-map', name: '地下管网图', kind: 'intel', rarity: 'red', value: 23000, quantity: 1, description: '标记黑峡地下设施的完整管网图。' },
    },
  ],
};

const FALL_RECOVERY_Y = -5;

const DIFFICULTIES: Record<DifficultyId, { enemyCount: number; health: number; damage: number; accuracy: number; fireDelay: number }> = {
  recruit: { enemyCount: 0.65, health: 1, damage: 1, accuracy: 1, fireDelay: 1 },
  standard: { enemyCount: 0.85, health: 1, damage: 1, accuracy: 1, fireDelay: 1 },
  veteran: { enemyCount: 1, health: 1, damage: 1, accuracy: 1, fireDelay: 1 },
};

const CONTAINER_RULES: Record<ContainerTier, { name: string; min: number; max: number; weights: number[]; scale: number; search: number }> = {
  bag: { name: '旅行袋', min: 1, max: 2, weights: [36, 31, 20, 9, 3, 0.9, 0.1], scale: 0.9, search: 1.6 },
  briefcase: { name: '手提箱', min: 1, max: 3, weights: [22, 28, 25, 15, 7, 2.7, 0.3], scale: 0.9, search: 2.1 },
  toolbox: { name: '工具箱', min: 2, max: 3, weights: [20, 28, 27, 16, 7, 1.8, 0.2], scale: 0.92, search: 2.3 },
  medical: { name: '医疗物资箱', min: 2, max: 4, weights: [12, 24, 29, 21, 10, 3.6, 0.4], scale: 0.92, search: 2.6 },
  computer: { name: '办公电脑', min: 1, max: 3, weights: [14, 22, 27, 21, 11, 4.4, 0.6], scale: 0.92, search: 2.4 },
  server: { name: '服务器机柜', min: 2, max: 4, weights: [5, 13, 24, 27, 19, 10.5, 1.5], scale: 1, search: 3.5 },
  ammo: { name: '弹药箱', min: 2, max: 4, weights: [13, 24, 27, 20, 11, 4.5, 0.5], scale: 0.86, search: 2.4 },
  locker: { name: '储物柜', min: 2, max: 4, weights: [15, 24, 26, 20, 10, 4.4, 0.6], scale: 0.95, search: 3 },
  case: { name: '物资箱', min: 2, max: 3, weights: [19, 27, 25, 17, 8.5, 3.2, 0.3], scale: 0.92, search: 2.5 },
  military: { name: '军用装备箱', min: 2, max: 4, weights: [8, 17, 25, 24, 16, 8.5, 1.5], scale: 1, search: 3.3 },
  weapon: { name: '大型武器箱', min: 3, max: 5, weights: [3, 10, 20, 27, 23, 14.5, 2.5], scale: 1.1, search: 4 },
  safe: { name: '加固保险柜', min: 3, max: 5, weights: [2, 7, 16, 25, 25, 20, 5], scale: 1, search: 4.2 },
  hidden: { name: '隐藏物资', min: 2, max: 5, weights: [6, 15, 24, 25, 18, 10.5, 1.5], scale: 0.88, search: 3.7 },
  vault: { name: '行政金库箱', min: 4, max: 6, weights: [0, 0, 1, 5, 16, 78, 0], scale: 1.08, search: 5.2 },
};

const ADMIN_RED_DROP_CHANCE = 0.02;
const ADMIN_UPPER_FLOOR_Y = 4.25;
const ADMIN_STAIRS = [{ x: 136, z: 17 }, { x: 194, z: 17 }] as const;
const ADMIN_SECRET_ROOM = { x: 132, z: -44, doorZ: -34 } as const;
const ADMIN_SECRET_DOOR_CLOSED_X = ADMIN_SECRET_ROOM.x;
const ADMIN_SECRET_DOOR_OPEN_X = ADMIN_SECRET_ROOM.x - 4.05;
const RESERVOIR_TERMINAL = { x: 382, y: -3.6, z: 74.05 } as const;
const RESERVOIR_TUNNEL_OPENING_WIDTH = 5;
const RESERVOIR_TUNNEL_OPENING_DEPTH = 15;
const TACTICAL_MAP_BOUNDS = {
  administration: { minX: 100, maxX: 230, minZ: -158, maxZ: 168 },
  reservoir: { minX: 236, maxX: 558, minZ: -132, maxZ: 132 },
} as const;
const HIGH_VALUE_TASKS: Partial<Record<MapId, HighValueTaskConfig>> = {
  administration: {
    title: '辖区净空',
    driveLabel: '行动硬盘',
    drive: { x: 160, y: 0.3, z: -30 },
    radio: { x: 171, y: 0.02, z: -30 },
  },
  reservoir: {
    title: '水库肃清',
    driveLabel: '水利主控硬盘',
    drive: { x: 467, y: 0.3, z: -68 },
    radio: { x: RESERVOIR_TERMINAL.x + 4.2, y: RESERVOIR_TERMINAL.y, z: RESERVOIR_TERMINAL.z },
  },
};
const HIGH_VALUE_TASK_REWARD: InventoryItem = {
  id: 'african-heart-red',
  name: '大红非洲之心',
  kind: 'intel',
  rarity: 'red',
  value: 50000,
  quantity: 1,
};

const RARITY_ORDER: InventoryItem['rarity'][] = ['black', 'white', 'green', 'blue', 'purple', 'gold', 'red'];
const MAX_RENDER_SCALE = 1.5;
const MIN_RENDER_SCALE = 0.62;
const MIN_FRAME_INTERVAL_MS = 1000 / 60 - 1;
const CONTEXT_RESTORE_RETRY_DELAY_MS = 1_200;
const MAX_CONTEXT_RESTORE_ATTEMPTS = 3;
const PLAYER_CROUCH_SPEED = 2.15;
const PLAYER_WALK_SPEED = 3.65;
const PLAYER_SPRINT_SPEED = 6.1;
const ENEMY_WALK_SPEED = PLAYER_WALK_SPEED;
const PLAYER_SPRINT_STAMINA_DRAIN = 10;
const PLAYER_STAMINA_RECOVERY = 14;
const MAP_RENDER_LAYERS: Record<MapId, number> = {
  harbor: 1,
  radar: 2,
  refinery: 3,
  administration: 4,
  reservoir: 5,
};

const WEAPON_CONFIGS: Record<WeaponId, WeaponConfig> = {
  rifle: {
    id: 'rifle', name: 'KR-56 突击步枪', slot: 1, magazineSize: 30, reserve: 90,
    fireInterval: 1 / 9, damage: 36, headshotDamage: 74, pellets: 1,
    hipSpread: 0.0085, aimSpread: 0.0026, reloadDuration: 2.15, recoil: 0.0045,
    color: '#28312c', receiverScale: 1, barrelScale: 1, muzzleZ: -1.03,
  },
  smg: {
    id: 'smg', name: 'V9 冲锋枪', slot: 2, magazineSize: 36, reserve: 108,
    fireInterval: 1 / 13, damage: 24, headshotDamage: 50, pellets: 1,
    hipSpread: 0.012, aimSpread: 0.0042, reloadDuration: 1.72, recoil: 0.003,
    color: '#34413c', receiverScale: 0.72, barrelScale: 0.62, muzzleZ: -0.82,
  },
  shotgun: {
    id: 'shotgun', name: 'SG-12 战术霰弹枪', slot: 3, magazineSize: 8, reserve: 32,
    fireInterval: 0.78, damage: 13, headshotDamage: 20, pellets: 7,
    hipSpread: 0.052, aimSpread: 0.026, reloadDuration: 2.75, recoil: 0.012,
    color: '#40382d', receiverScale: 1.18, barrelScale: 1.15, muzzleZ: -1.12,
  },
};

// The game starts with these three built-in weapons. Optional weapon-variant
// scripts can extend the loadout later, but the core game must boot on its own.
const WEAPON_IDS: WeaponId[] = ['rifle', 'smg', 'shotgun'];

export class CriticalExtractionGame {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: GameCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(74, 1, 0.06, 420);
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly weaponClearanceRaycaster = new THREE.Raycaster();
  private readonly acousticRaycaster = new THREE.Raycaster();
  private readonly weaponClearanceDirection = new THREE.Vector3();
  private readonly audio = new TacticalAudio();
  private readonly keys = new Set<string>();
  private readonly blockers: THREE.Object3D[] = [];
  private readonly acousticRoofs: THREE.Object3D[] = [];
  private readonly tracers: TracerRuntime[] = [];
  private readonly shells: ShellRuntime[] = [];
  private readonly bloodParticles: BloodParticleRuntime[] = [];
  private readonly impactParticles: ImpactParticleRuntime[] = [];
  private readonly destructibles: DestructibleRuntime[] = [];
  private readonly smokes: SmokeRuntime[] = [];
  private smokeTexture: THREE.CanvasTexture | null = null;
  private impactMaterials!: Record<ImpactSurface | 'armor', THREE.MeshBasicMaterial>;
  private readonly loot: LootRuntime[] = [];
  private readonly corpseLoot: LootRuntime[] = [];
  private readonly enemies: EnemyRuntime[] = [];
  private readonly enemyHitMeshes: THREE.Object3D[] = [];
  private readonly staticPointLights: THREE.PointLight[] = [];
  private readonly sharedBoxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly containerPrototypes = new Map<ContainerTier, THREE.Group>();
  private readonly lightWorldPosition = new THREE.Vector3();
  private readonly audioForward = new THREE.Vector3();
  private readonly enemyEyeScratch = new THREE.Vector3();
  private readonly enemyToPlayerScratch = new THREE.Vector3();
  private readonly enemyDirectionScratch = new THREE.Vector3();
  private readonly enemyPreviousScratch = new THREE.Vector3();
  private readonly enemyDesiredScratch = new THREE.Vector3();
  private readonly enemyMovedScratch = new THREE.Vector3();
  private entityManager = new YUKA.EntityManager();
  private physicsWorld!: RAPIER.World;
  private sun!: THREE.DirectionalLight;
  private hemisphere!: THREE.HemisphereLight;
  private readonly sunTarget = new THREE.Object3D();
  private readonly sunShadowFocus = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY);
  private playerBody!: RAPIER.RigidBody;
  private playerCollider!: RAPIER.Collider;
  private characterController!: RAPIER.KinematicCharacterController;
  private run = createRunState();
  private activeOperation: OperationConfig = OPERATIONS.harbor;
  private activeDifficulty: DifficultyId = 'standard';
  private activeBossMode: BossMode = 'single';
  private activeGameMode: GameModeId = 'extraction';
  private operationSeed = '';
  private availableWeapons = new Set<WeaponId>(WEAPON_IDS);
  private extractionIntelUnlocked = true;
  private carriedObjective = false;
  private continuousStage = 0;
  private continuousElapsedTotal = 0;
  private nightVisionActive = false;
  private flashlightOn = false;
  private readonly survivalDurationSeconds = 120;
  private operationScenario!: OperationScenario;
  private operationTaskProgress!: TaskProgress;
  private extractionConditionProgress!: ExtractionConditionProgress;
  private challengeDefinitions: ChallengeDefinition[] = [];
  private challengeProgress: ChallengeProgress[] = [];
  private eventStartsAt = 35;
  private eventEndsAt = 0;
  private eventStarted = false;
  private operationTaskRevealed = false;
  private operationTaskRevealedAt = 0;
  private nextGasDamageAt = 0;
  private nextLootThreatPulseAt = 0;
  private currentRiskHigh = false;
  private threatEscalation: ThreatEscalation = getThreatEscalation(0);
  private lastThreatLevelToast = 0;
  private designatedGuard: EnemyRuntime | null = null;
  private operationTaskRewardGranted = false;
  private weaponTunings: Partial<Record<WeaponId, WeaponBuildEffects>> = {};
  private objectiveCase!: THREE.Group;
  private carriedCargo!: THREE.Group;
  private flashlight!: THREE.SpotLight;
  private missionTerminal!: THREE.Group;
  private taskHardDrive!: THREE.Group;
  private taskRadio!: THREE.Group;
  private administrationSecretDoor!: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  private administrationSecretDoorCollider: RAPIER.Collider | null = null;
  private administrationSecretReader!: THREE.Group;
  private administrationSecretUnlocked = false;
  private administrationSecretGate: ShortcutGateState = createShortcutGate();
  private extractionMarker!: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private extractionBeam!: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private extractionRing!: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private extractionLabel!: THREE.Sprite;
  private extractionBeacon!: THREE.Group;
  private extractionLight!: THREE.PointLight;
  private extractionSmoke!: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private water!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>;
  private weapon!: THREE.Group;
  private weaponReceiver!: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  private weaponBarrel!: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
  private weaponMagazine!: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  private leftPlayerArm!: THREE.Group;
  private rightPlayerArm!: THREE.Group;
  private muzzleFlash!: THREE.Group;
  private muzzleFlashLight!: THREE.PointLight;
  private muzzleFlashEndsAt = -100;
  private nearestInteraction: LootRuntime | 'objective' | 'checkpoint' | 'task-item' | 'task-radio' | 'extract-condition' | 'secret-reader' | 'field-trader' | null = null;
  private lootSearch: LootSearchRuntime | null = null;
  private yaw = 0;
  private pitch = 0;
  private verticalVelocity = 0;
  private cameraHeight = 0.62;
  private firing = false;
  private aiming = false;
  private controlsActive = false;
  private pointerLockPending = false;
  // Some embedded browsers reject Pointer Lock. Keep a usable trackpad fallback
  // so the game does not become keyboard-only in that case.
  private fallbackLookActive = false;
  private fallbackPointerX = 0;
  private fallbackPointerY = 0;
  private cameraRecoil = 0;
  private shotSway = 0;
  private weaponRecoilKick = 0;
  private recoilShotIndex = 0;
  private weaponAction: 'idle' | 'switch' | 'inspect' = 'idle';
  private weaponActionStartedAt = -100;
  private weaponActionEndsAt = -100;
  private reloadStage = 0;
  private reloadStyle: ReloadStyle = 'tactical';
  private activeReloadDuration = 1;
  private weaponWallBlend = 0;
  private weaponWallBlocked = false;
  private weaponHurtStartedAt = -100;
  private weaponHurtEndsAt = -100;
  private weaponHurtSide = 1;
  private motionPhase = 0;
  private motionBlend = 0;
  private crouchBlend = 0;
  private sprintBlend = 0;
  private groundedBlend = 1;
  private readonly lastSafePlayerPosition = new THREE.Vector3(0, 0.9, 0);
  // Detect the rare case where a capsule gets wedged in a wall corner or door frame.
  private stuckPlayerSeconds = 0;
  private lastPlayerHorizontalPosition = new THREE.Vector3();
  private lastStuckRecoveryAt = -100;
  private currentMoveSpeed = PLAYER_WALK_SPEED;
  private landingKick = 0;
  private lastStepIndex = 0;
  private nextBreathAt = 0;
  private nextAmbientAt = 0;
  private nextDistantShotAt = 0;
  private nextPipeEchoAt = 0;
  private nextExtractionSignalAt = 0;
  private lookSwayX = 0;
  private lookSwayY = 0;
  private jumpQueuedUntil = 0;
  private activeWeaponId: WeaponId = 'rifle';
  private weaponStates = new Map<WeaponId, WeaponState>();
  private backpackCapacity = 12;
  private nextShotAt = 0;
  private lastShotAt = -100;
  private lastShotPosition = new THREE.Vector3();
  private lastShotNoiseRadius = 0;
  private lastPlayerNoiseAt = -100;
  private lastPlayerNoisePosition = new THREE.Vector3();
  private lastPlayerNoiseRadius = 0;
  private lastDamagedAt = -100;
  private combatGraceEndsAt = 0;
  private healingEndsAt = 0;
  private healingTreatment: MedicalTreatment | 'medkit' = 'medkit';
  private smokeCooldownEndsAt = 0;
  private adrenalineCooldownEndsAt = 0;
  private adrenalineEndsAt = 0;
  private adrenalineHealingRemaining = 0;
  private runCooldownEndsAt = 0;
  private runEndsAt = 0;
  private deployEndsAt = 0;
  private updateAccumulator = 0;
  private aiAccumulator = 0;
  private performanceAccumulator = 0;
  private performanceFrames = 0;
  private lightCullingAccumulator = 0;
  private lastLootUiUpdatedAt = -100;
  private lastRenderedAt = 0;
  private renderScale = Math.min(window.devicePixelRatio || 1, MAX_RENDER_SCALE);
  private qualityMinScale = 0.8;
  private qualityMaxScale = 1.25;
  private qualityLevel: QualityLevel = 'high';
  private qualityLightDistance = 38;
  private readonly mapRenderRoots = new Map<MapId, THREE.Group>();
  private settings: GameSettings = createDefaultSettings();
  private menuTime = 0;
  private lastThreatWarningAt = -100;
  private focusedBoss: EnemyRuntime | null = null;
  private administrationEntered = false;
  private reservoirTunnelEntered = false;
  private reservoirTerminalActivated = false;
  private highValueTaskStage: HighValueTaskStage = 'inactive';
  private disposed = false;
  private animationFrameId = 0;
  private animationFaulted = false;
  private backgroundContextReleaseTimer = 0;
  private contextRestoreTimer = 0;
  private contextRestoreAttempts = 0;
  private webGlContextLost = false;
  private webGlSuspendedInBackground = false;
  private debugPreviewActive = false;
  private debugPreviewWalkingEnemy: EnemyRuntime | null = null;

  constructor(canvas: HTMLCanvasElement, callbacks: GameCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.46;
    this.camera.rotation.order = 'YXZ';
    this.raycaster.layers.enableAll();
    this.acousticRaycaster.layers.enableAll();
  }

  applySettings(settings: GameSettings): void {
    this.settings = { ...settings, keyBindings: { ...settings.keyBindings } };
    this.audio.setVolume(settings.volume);
    const deviceScale = Math.max(1, window.devicePixelRatio || 1);
    const quality = {
      low: { target: 0.68, min: MIN_RENDER_SCALE, max: 0.76, shadows: false, shadowSize: 512, lights: 0, fog: 0.0037, far: 250 },
      medium: { target: 0.82, min: 0.66, max: 0.9, shadows: true, shadowSize: 768, lights: 18, fog: 0.003, far: 330 },
      high: { target: Math.min(deviceScale, 1), min: 0.7, max: 1, shadows: true, shadowSize: 1024, lights: 28, fog: 0.00235, far: 430 },
      ultra: { target: Math.min(deviceScale, 1.2), min: 0.82, max: 1.25, shadows: true, shadowSize: 1536, lights: 42, fog: 0.0019, far: 520 },
    }[settings.quality];
    this.qualityLevel = settings.quality;
    this.qualityMinScale = quality.min;
    this.qualityMaxScale = quality.max;
    this.qualityLightDistance = quality.lights;
    this.renderScale = THREE.MathUtils.clamp(quality.target, this.qualityMinScale, this.qualityMaxScale);
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.needsUpdate = quality.shadows;
    this.camera.far = quality.far;
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = quality.fog;
    if (this.sun) {
      this.sun.castShadow = quality.shadows;
      if (this.sun.shadow.mapSize.width !== quality.shadowSize) {
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
        this.sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
      }
    }
    if (!this.aiming) {
      this.camera.fov = settings.fieldOfView;
      this.camera.updateProjectionMatrix();
    }
    this.resize();
  }

  async initialize(): Promise<void> {
    await RAPIER.init();
    this.physicsWorld = new RAPIER.World({ x: 0, y: -18, z: 0 });
    this.buildEnvironment();
    this.applySettings(this.settings);
    this.createPlayerPhysics();
    this.createWeapon();
    this.weapon.visible = false;
    this.createObjectiveAndLoot();
    // The world is static, so its expensive shadow map only needs to be rendered once.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.bindEvents();
    this.resize();
    this.camera.position.set(-42, 18, 51);
    this.camera.lookAt(-3, 2, -5);
    this.clock.start();
    this.animate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrameId);
    window.clearTimeout(this.backgroundContextReleaseTimer);
    window.clearTimeout(this.contextRestoreTimer);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('webglcontextlost', this.onWebGlContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onWebGlContextRestored);
    this.audio.dispose();
    this.disposeDynamicObject(this.scene);
    this.smokeTexture?.dispose();
    this.smokeTexture = null;
    if (this.characterController) this.characterController.free();
    if (this.physicsWorld) this.physicsWorld.free();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  startRun(
    mapId: MapId = this.activeOperation.id,
    difficulty: DifficultyId = this.activeDifficulty,
    supplies: { armor: number; ammo: number; medkits: number; backpackSlots?: number; weapon?: WeaponId; weaponTunings?: Partial<Record<WeaponId, WeaponBuildEffects>>; armorLevel?: number; ammoLevel?: AmmoLevel; loadoutValue?: number; secureContainerCapacity?: number; continuousStage?: number; startingItems?: InventoryItem[]; armorDurabilityPercent?: number; weaponDurabilityPercent?: number } = { armor: 0, ammo: 0, medkits: 0 },
    bossMode: BossMode = 'single',
    gameMode: GameModeId = 'extraction',
  ): void {
    const baseOperation = OPERATIONS[mapId] ?? OPERATIONS.harbor;
    this.operationSeed = `${baseOperation.id}-${difficulty}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const layout = selectOperationLayout(baseOperation.id, this.operationSeed);
    this.activeOperation = {
      ...baseOperation,
      spawn: { ...layout.spawn },
      extraction: { ...layout.extraction },
    };
    this.activeDifficulty = DIFFICULTIES[difficulty] ? difficulty : 'standard';
    this.activeBossMode = bossMode === 'double' ? 'double' : 'single';
    this.activeGameMode = gameMode;
    const mode = gameModeDefinition(this.activeGameMode);
    this.availableWeapons = new Set(mode.allowedWeapons ?? WEAPON_IDS);
    if (this.activeGameMode === 'zero') this.availableWeapons.clear();
    this.extractionIntelUnlocked = this.activeGameMode !== 'random-extract';
    this.carriedObjective = false;
    this.weapon.visible = true;
    this.focusSunOnOperation();
    this.audio.unlock();
    this.run = createRunState();
    this.configureOperationSystems();
    const maximumArmor = this.activeGameMode === 'zero' ? 0 : Math.min(140, this.run.player.armor + supplies.armor);
    const armorCondition = Math.max(0, Math.min(1, (supplies.armorDurabilityPercent ?? 100) / 100));
    this.run.player.armor = Math.round(maximumArmor * armorCondition);
    this.run.player.armorLevel = Math.max(1, Math.min(6, supplies.armorLevel ?? 1));
    this.run.player.armorDurability = this.run.player.armor;
    this.run.player.maxArmorDurability = maximumArmor;
    this.run.player.weaponDurability = Math.max(0, Math.min(100, supplies.weaponDurabilityPercent ?? 100));
    this.run.player.maxWeaponDurability = 100;
    this.run.player.ammoLevel = supplies.ammoLevel ?? 1;
    this.run.player.secureContainerCapacity = Math.max(1, Math.min(4, supplies.secureContainerCapacity ?? 2));
    this.run.loadoutValue = Math.max(0, supplies.loadoutValue ?? 0);
    if (this.activeGameMode === 'training') {
      this.run.player.health = 100;
      this.run.player.armor = 140;
      this.run.player.armorDurability = 140;
      this.run.player.maxArmorDurability = 140;
      this.run.player.armorLevel = 6;
      this.run.player.weaponDurability = 100;
      this.run.player.maxWeaponDurability = 100;
      this.run.objectiveText = '射击训练场 · 10–75 米目标 · 1–6 级护甲 · 无限弹药与耐久';
    }
    this.continuousStage = Math.max(0, Math.min(2, supplies.continuousStage ?? 0));
    if (this.activeGameMode === 'continuous') this.run.routeLog.push(`连续行动第 ${this.continuousStage + 1} 阶段 · ${this.activeOperation.name}`);
    this.run.player.medkits = this.activeGameMode === 'zero' ? 0 : this.run.player.medkits + supplies.medkits;
    this.backpackCapacity = Math.max(12, supplies.backpackSlots ?? 12);
    this.run.backpack = (supplies.startingItems ?? [])
      .slice(0, this.backpackCapacity)
      .map((item) => ({ ...item }));
    this.weaponTunings = supplies.weaponTunings ?? {};
    this.run.objectiveText = this.activeGameMode === 'training'
      ? '射击训练场 · 10–75 米目标 · 1–6 级护甲 · 无限弹药与耐久'
      : this.activeOperation.objectiveText;
    const requestedWeapon = supplies.weapon ?? 'rifle';
    const startingWeapon = this.availableWeapons.has(requestedWeapon)
      ? requestedWeapon
      : [...this.availableWeapons][0] ?? 'smg';
    this.resetWeaponLoadout(startingWeapon);
    if (this.activeGameMode === 'training') {
      const trainingWeapon = this.weaponStates.get(this.activeWeaponId);
      if (trainingWeapon) {
        trainingWeapon.magazine = 999;
        trainingWeapon.reserve = 999;
        trainingWeapon.reloading = false;
      }
    }
    for (const [weaponId, state] of this.weaponStates) {
      if (this.activeGameMode === 'zero' || !this.availableWeapons.has(weaponId)) {
        state.magazine = 0;
        state.reserve = 0;
      } else {
        state.reserve += supplies.ammo;
      }
    }
    this.run.player.weapon = this.weaponStates.get(this.activeWeaponId)!;
    this.run.phase = 'deploying';
    this.debugPreviewActive = false;
    this.debugPreviewWalkingEnemy = null;
    this.resetDynamicWorld();
    this.prepareModeLoot();
    this.applyModeEnvironment();
    this.yaw = this.activeOperation.id === 'reservoir' ? -0.48 : 0;
    this.pitch = 0;
    this.verticalVelocity = 0;
    this.cameraRecoil = 0;
    this.shotSway = 0;
    this.motionPhase = 0;
    this.motionBlend = 0;
    this.crouchBlend = 0;
    this.sprintBlend = 0;
    this.groundedBlend = 1;
    this.currentMoveSpeed = PLAYER_WALK_SPEED;
    this.landingKick = 0;
    this.lastStepIndex = 0;
    this.nextBreathAt = performance.now() / 1000 + 1.2;
    this.nextAmbientAt = performance.now() / 1000 + 1.5;
    this.nextDistantShotAt = performance.now() / 1000 + 4 + Math.random() * 4;
    this.nextPipeEchoAt = performance.now() / 1000 + 3;
    this.nextExtractionSignalAt = performance.now() / 1000 + 1.8;
    this.smokeCooldownEndsAt = 0;
    this.adrenalineCooldownEndsAt = 0;
    this.adrenalineEndsAt = 0;
    this.adrenalineHealingRemaining = 0;
    this.runCooldownEndsAt = 0;
    this.runEndsAt = 0;
    this.lookSwayX = 0;
    this.lookSwayY = 0;
    this.jumpQueuedUntil = 0;
    this.deployEndsAt = performance.now() / 1000 + 0.9;
    this.combatGraceEndsAt = performance.now() / 1000 + 8;
    this.callbacks.onDeploying(true);
    this.controlsActive = false;
    this.callbacks.onControlCapture(false);
    this.callbacks.onUpdate(this.run);
    this.callbacks.onMiniMap(this.createMiniMapView());
    this.emitAbilityView(performance.now() / 1000);
  }

  showMenuPreview(): void {
    this.run.phase = 'menu';
    this.weapon.visible = false;
    this.firing = false;
    this.setAiming(false);
    this.focusSunOnOperation('harbor');
    this.restoreDayEnvironment();
  }

  private restoreDayEnvironment(): void {
    if (!this.sun || !this.hemisphere) return;
    this.sun.intensity = 3.9;
    this.hemisphere.intensity = 1.65;
    this.scene.background = new THREE.Color('#a9c0c2');
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.color.set('#aabbb6');
    this.renderer.toneMappingExposure = 1.46;
    this.flashlightOn = false;
    this.nightVisionActive = false;
    if (this.flashlight) this.flashlight.intensity = 0;
    this.canvas.classList.remove('is-night-operation', 'is-night-vision');
  }

  private applyModeEnvironment(): void {
    if (this.activeGameMode !== 'night') {
      this.restoreDayEnvironment();
      return;
    }
    this.sun.intensity = 0.14;
    this.hemisphere.intensity = 0.22;
    this.scene.background = new THREE.Color('#05080b');
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.color.set('#09100f');
    this.renderer.toneMappingExposure = 0.88;
    this.flashlightOn = true;
    this.flashlight.intensity = 68;
    this.nightVisionActive = false;
    this.canvas.classList.add('is-night-operation');
    this.canvas.classList.remove('is-night-vision');
    this.callbacks.onToast('夜战装备就绪 · N 切换夜视仪');
  }

  private toggleNightVision(): void {
    if (this.activeGameMode !== 'night') return;
    this.nightVisionActive = !this.nightVisionActive;
    this.flashlightOn = !this.nightVisionActive;
    this.flashlight.intensity = this.flashlightOn ? 68 : 0;
    this.renderer.toneMappingExposure = this.nightVisionActive ? 1.38 : 0.88;
    this.canvas.classList.toggle('is-night-vision', this.nightVisionActive);
    this.callbacks.onToast(this.nightVisionActive ? '夜视仪已开启' : '夜视仪已关闭 · 手电筒开启');
  }

  private prepareModeLoot(): void {
    const activeLoot = this.loot
      .filter((entry) => entry.operationId === this.activeOperation.id)
      .sort((left, right) => left.position.distanceToSquared(new THREE.Vector3(this.activeOperation.spawn.x, 0, this.activeOperation.spawn.z))
        - right.position.distanceToSquared(new THREE.Vector3(this.activeOperation.spawn.x, 0, this.activeOperation.spawn.z)));
    const starter = activeLoot[0];
    if (this.activeGameMode === 'zero' && starter) {
      starter.equipment.unshift({
        id: `zero-raid-v9-${this.activeOperation.id}`,
        name: '战区拾取 V9',
        kind: 'weapon',
        rarity: 'green',
        value: 1600,
        quantity: 1,
        variant: 'smg',
        equipmentSlot: 'weapon',
        description: '零装突袭的应急武器，拾取后立即可以使用。',
      });
      this.weapon.visible = false;
      this.callbacks.onToast('零装突袭 · 搜索附近物资点取得第一把武器');
    }
    if (this.activeGameMode === 'random-extract' && starter) {
      starter.items.unshift({
        id: `extraction-map-${this.activeOperation.id}`,
        name: '撤离频段地图',
        kind: 'intel',
        rarity: 'blue',
        value: 2200,
        quantity: 1,
        description: '标有本局撤离频段和坐标，拾取后解锁撤离点。',
      });
      this.callbacks.onToast('撤离坐标未知 · 搜索地图情报');
    }
    const boosts = gameModeDefinition(this.activeGameMode).lootBoosts;
    if (boosts > 0) {
      const random = new SeededRandom(Math.floor(performance.now()) + this.activeOperation.spawn.x);
      for (const entry of activeLoot) {
        for (let index = 0; index < boosts; index += 1) this.enrichHighRiskLoot(entry.items, random);
      }
    }
    if (this.activeGameMode === 'boss-hunt') {
      for (const enemy of this.enemies.filter((entry) => entry.boss)) {
        enemy.bossReward = {
          id: `boss-hunt-red-${this.activeOperation.id}-${enemy.name}`,
          name: `${enemy.name}的红色身份牌`,
          kind: 'intel',
          rarity: 'red',
          value: 32000,
          quantity: 1,
          description: '首领追猎专属红色战利品。',
        };
      }
    }
    this.setExtractionMarkerVisible(this.activeGameMode !== 'random-extract');
  }

  private setExtractionMarkerVisible(visible: boolean): void {
    this.extractionMarker.visible = visible;
    this.extractionBeam.visible = visible;
    this.extractionRing.visible = visible;
    this.extractionLabel.visible = visible;
    this.extractionBeacon.visible = visible;
    this.extractionSmoke.visible = visible;
    this.extractionLight.visible = visible;
  }

  resume(): void {
    if (this.run.phase !== 'paused') return;
    this.run.phase = this.run.extractionProgress > 0 ? 'extracting' : 'active';
    this.captureControls();
  }

  captureControls(): void {
    if (!['deploying', 'active', 'extracting'].includes(this.run.phase)) return;
    if (document.pointerLockElement === this.canvas) return;
    this.controlsActive = false;
    this.callbacks.onControlStatus('视角控制：正在锁定鼠标…');
    this.requestLookLock();
  }

  abortRun(): void {
    if (!['active', 'extracting', 'paused', 'deploying'].includes(this.run.phase)) return;
    this.failRun('行动已放弃');
  }

  debugGiveObjective(): void {
    this.takeObjective();
  }

  debugTeleportToObjective(): void {
    this.teleport(this.activeOperation.objective.x, this.activeOperation.objective.z);
  }

  debugTeleportToExtraction(): void {
    this.teleport(this.activeOperation.extraction.x, this.activeOperation.extraction.z);
  }

  debugGiveAdministrationAccessCard(): void {
    if (this.activeOperation.id !== 'administration') return;
    const result = addInventoryItem(this.run.backpack, { ...ADMIN_SECRET_CARD }, this.backpackCapacity);
    if (result.added) this.run.backpack = result.items;
    this.callbacks.onUpdate(this.run);
  }

  debugDamage(amount = 20): void {
    this.damagePlayer(amount);
  }

  debugPreviewCorpseLoot(preferBoss = false, openLoot = true): void {
    const enemy = preferBoss
      ? this.enemies.find((entry) => entry.boss && entry.alive)
      : this.enemies.find((entry) => !entry.boss && !entry.elite && entry.alive)
        ?? this.enemies.find((entry) => !entry.boss && entry.alive);
    if (!enemy) return;
    this.run.phase = 'active';
    this.callbacks.onDeploying(false);
    this.damageEnemy(enemy, enemy.maxHealth * 3, 'head');
    const entry = this.corpseLoot[this.corpseLoot.length - 1];
    if (!entry) return;
    this.teleport(entry.position.x, entry.position.z + 0.7);
    this.nearestInteraction = entry;
    if (!openLoot) {
      this.pitch = -0.72;
      return;
    }
    this.startLootSearch(entry);
    if (!this.lootSearch) return;
    const now = performance.now() / 1000;
    this.lootSearch.startedAt = now - this.lootSearch.duration;
    this.updateLootSearch(now);
  }

  debugPreviewEnemyModel(preferBoss = false, walking = false): void {
    const enemy = preferBoss
      ? this.enemies.find((entry) => entry.boss && entry.alive)
      : this.enemies.find((entry) => !entry.boss && !entry.elite && entry.alive)
        ?? this.enemies.find((entry) => !entry.boss && entry.alive);
    if (!enemy) return;
    this.debugPreviewActive = true;
    this.debugPreviewWalkingEnemy = walking ? enemy : null;
    const groundY = enemy.floorY;
    const x = enemy.group.position.x;
    const z = enemy.group.position.z;
    this.debugPreviewLocation(x, z + 2.7, groundY, 0);
    this.weapon.visible = false;
    this.combatGraceEndsAt = Number.POSITIVE_INFINITY;
    enemy.group.position.set(x, groundY, z);
    enemy.group.rotation.set(0, 0, 0);
    enemy.facing.set(0, 0, 1);
    enemy.vehicle.position.set(x, 0, z);
    enemy.vehicle.velocity.set(0, 0, 0);
    enemy.vehicle.maxSpeed = 0;
    enemy.vehicle.steering.clear();
    enemy.lastAnimationPosition.copy(enemy.group.position);
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
    return this.discardBackpackItems([itemId], 'discard');
  }

  discardBackpackItems(itemIds: string[], action: 'discard' | 'destroy' = 'discard'): boolean {
    if (!['deploying', 'active', 'extracting', 'paused'].includes(this.run.phase)) return false;
    let items = this.run.backpack;
    const removed: InventoryItem[] = [];
    for (const itemId of [...new Set(itemIds)]) {
      const result = discardInventoryItem(items, itemId);
      if (result.discarded) {
        removed.push(result.discarded);
        items = result.items;
      }
    }
    if (removed.length === 0) return false;
    this.run.backpack = items;
    this.callbacks.onUpdate(this.run);
    const verb = action === 'destroy' ? '已销毁' : '已丢弃';
    const summary = removed.length === 1
      ? `${verb} ${removed[0].name}${removed[0].quantity > 1 ? ` × ${removed[0].quantity}` : ''}`
      : `${verb} ${removed.length} 件物品`;
    this.callbacks.onToast(summary, action === 'destroy' ? 'danger' : 'info');
    return true;
  }

  secureBackpackItem(itemId: string): boolean {
    if (!['deploying', 'active', 'extracting', 'paused'].includes(this.run.phase)) return false;
    const result = moveItemToSecureContainer(
      this.run.backpack,
      this.run.player.secureContainer,
      itemId,
      this.run.player.secureContainerCapacity,
    );
    if (!result.moved) {
      this.callbacks.onToast('安全箱已满，或该装备不能放入安全箱', 'danger');
      return false;
    }
    this.run.backpack = result.backpack;
    this.run.player.secureContainer = result.secureContainer;
    this.callbacks.onUpdate(this.run);
    this.callbacks.onToast('物资已放入安全箱，行动失败也会保留');
    return true;
  }

  unsecureItem(itemId: string): boolean {
    const result = moveItemFromSecureContainer(
      this.run.backpack,
      this.run.player.secureContainer,
      itemId,
      this.backpackCapacity,
    );
    if (!result.moved) return false;
    this.run.backpack = result.backpack;
    this.run.player.secureContainer = result.secureContainer;
    this.callbacks.onUpdate(this.run);
    return true;
  }

  closeFieldMarket(): void { this.callbacks.onFieldMarket?.(null); }

  tradeFieldMarket(kind: 'ammo' | 'medical' | 'intel'): boolean {
    if (!['active', 'extracting', 'paused'].includes(this.run.phase)) return false;
    const index = this.run.backpack.findIndex((item) => item.kind !== 'weapon' && item.kind !== 'armor' && item.kind !== 'helmet');
    if (index < 0) {
      this.callbacks.onToast('黑市需要一件可交换的背包物资', 'danger');
      return false;
    }
    const item = this.run.backpack[index];
    this.run.backpack = item.quantity > 1
      ? this.run.backpack.map((entry, entryIndex) => entryIndex === index ? { ...entry, quantity: entry.quantity - 1 } : entry)
      : this.run.backpack.filter((_, entryIndex) => entryIndex !== index);
    if (kind === 'ammo') this.run.player.weapon.reserve += 30;
    if (kind === 'medical') this.run.player.medkits += 1;
    if (kind === 'intel') {
      this.extractionIntelUnlocked = true;
      this.run.routeLog.push('通过局内黑市获得撤离情报');
    }
    this.callbacks.onUpdate(this.run);
    this.callbacks.onToast(`黑市交易完成 · ${item.name} 已换取${kind === 'ammo' ? '30 发弹药' : kind === 'medical' ? '1 个医疗包' : '撤离情报'}`);
    this.callbacks.onFieldMarket?.(null);
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
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('webglcontextlost', this.onWebGlContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onWebGlContextRestored);
  }

  private readonly onContextMenu = (event: MouseEvent): void => { event.preventDefault(); };

  private releaseHeldInputs(): void {
    this.keys.clear();
    this.firing = false;
    this.jumpQueuedUntil = 0;
    this.setAiming(false);
  }

  private readonly onWindowBlur = (): void => {
    this.releaseHeldInputs();
  };

  private readonly onVisibilityChange = (): void => {
    window.clearTimeout(this.backgroundContextReleaseTimer);
    this.backgroundContextReleaseTimer = 0;
    if (document.hidden) {
      this.releaseHeldInputs();
      // 后台标签页只暂停更新，不主动销毁 WebGL 上下文。部分浏览器和内置预览
      // 无法可靠地恢复被脚本强制销毁的上下文，回来后会表现为白屏或闪退。
      this.webGlSuspendedInBackground = true;
      return;
    }
    const wasSuspended = this.webGlSuspendedInBackground;
    this.webGlSuspendedInBackground = false;
    if (wasSuspended && this.webGlContextLost) {
      this.contextRestoreAttempts = 0;
      this.scheduleContextRestore(50);
    }
  };

  private readonly onWebGlContextLost = (event: Event): void => {
    event.preventDefault();
    this.webGlContextLost = true;
    this.controlsActive = false;
    this.releaseHeldInputs();
    this.callbacks.onControlCapture(false);
    if (this.webGlSuspendedInBackground) return;
    this.callbacks.onControlStatus('画面资源正在恢复，请稍候');
    this.callbacks.onToast('画面资源不足，正在尝试恢复', 'danger');
    this.contextRestoreAttempts = 0;
    this.scheduleContextRestore(CONTEXT_RESTORE_RETRY_DELAY_MS);
  };

  private readonly onWebGlContextRestored = (): void => {
    const resumedFromBackground = this.webGlSuspendedInBackground;
    window.clearTimeout(this.contextRestoreTimer);
    this.contextRestoreTimer = 0;
    this.contextRestoreAttempts = 0;
    this.webGlContextLost = false;
    this.webGlSuspendedInBackground = false;
    if (!resumedFromBackground && (this.qualityLevel === 'high' || this.qualityLevel === 'ultra')) {
      const preferredSettings = this.settings;
      this.applySettings({ ...preferredSettings, quality: 'medium' });
      this.settings = preferredSettings;
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
    if (this.animationFaulted && !this.disposed) {
      this.animationFaulted = false;
      this.clock.getDelta();
      this.animate();
    }
    this.callbacks.onControlStatus('画面已恢复 · 点击画面继续');
    if (!resumedFromBackground) this.callbacks.onToast('画面已经恢复，已自动降低画面压力');
  };

  private scheduleContextRestore(delay: number): void {
    window.clearTimeout(this.contextRestoreTimer);
    this.contextRestoreTimer = window.setTimeout(() => {
      this.contextRestoreTimer = 0;
      if (this.disposed || (!this.webGlContextLost && !this.webGlSuspendedInBackground)) return;
      this.contextRestoreAttempts += 1;
      this.renderer.forceContextRestore();
      if (!this.webGlContextLost) return;
      if (this.contextRestoreAttempts < MAX_CONTEXT_RESTORE_ATTEMPTS) {
        this.scheduleContextRestore(CONTEXT_RESTORE_RETRY_DELAY_MS);
        return;
      }
      this.animationFaulted = true;
      cancelAnimationFrame(this.animationFrameId);
      this.callbacks.onFatalError(new Error('画面资源连续恢复失败'));
    }, delay);
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
    if (this.isActionCode(event.code, 'jump') && !event.repeat) this.jumpQueuedUntil = performance.now() / 1000 + 0.16;
    if (event.code === 'Escape' && ['active', 'extracting'].includes(this.run.phase)) {
      event.preventDefault();
      if (this.lootSearch) {
        this.cancelLootSearch();
        return;
      }
      this.pauseRun();
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      return;
    }
    if (event.code === 'KeyE') this.interact();
    if (event.code === 'Digit1') this.switchWeapon('rifle');
    if (event.code === 'Digit2') this.switchWeapon('smg');
    if (event.code === 'Digit3') this.switchWeapon('shotgun');
    if (event.code === 'KeyQ') this.setAiming(!this.aiming);
    if (this.isActionCode(event.code, 'reload') && !event.repeat) this.startReload();
    if (this.isActionCode(event.code, 'run') && !event.repeat) this.activateRun();
    if (event.code === 'Digit4') this.useMedkit();
    if (event.code === 'ArrowLeft') this.applyLook(-18, 0, 0.002);
    if (event.code === 'ArrowRight') this.applyLook(18, 0, 0.002);
    if (event.code === 'ArrowUp') this.applyLook(0, -18, 0.002);
    if (event.code === 'ArrowDown') this.applyLook(0, 18, 0.002);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!['deploying', 'active', 'extracting'].includes(this.run.phase)) return;
    if (!this.controlsActive) return;
    const isPointerLocked = document.pointerLockElement === this.canvas;
    if (!isPointerLocked && !this.fallbackLookActive) return;
    const dx = isPointerLocked ? event.movementX : event.clientX - this.fallbackPointerX;
    const dy = isPointerLocked ? event.movementY : event.clientY - this.fallbackPointerY;
    if (!isPointerLocked) {
      this.fallbackPointerX = event.clientX;
      this.fallbackPointerY = event.clientY;
    }
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (Math.abs(dx) + Math.abs(dy) === 0 || Math.abs(dx) + Math.abs(dy) > 240) return;
    const inputScale = Math.abs(dx) + Math.abs(dy) <= 12
      ? this.settings.trackpadSensitivity
      : this.settings.mouseSensitivity;
    this.applyLook(dx, dy, (this.aiming ? 0.00115 : 0.0021) * inputScale);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!['active', 'extracting'].includes(this.run.phase)) return;
    const target = event.target as Element | null;
    if (target?.closest('button, .inventory-panel, .corpse-loot-panel, .pause-screen, .result-screen, .stash-screen')) return;
    if (!this.controlsActive) {
      this.fallbackPointerX = event.clientX;
      this.fallbackPointerY = event.clientY;
      this.captureControls();
      return;
    }
    if (event.button === 0) {
      if (this.weaponAction === 'inspect') this.weaponAction = 'idle';
      // Keep the trigger held through a switch animation; updateWeapon waits
      // for the action to finish before it can actually fire.
      this.firing = true;
    }
    if (event.button === 2) this.setAiming(true);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.button === 0) this.firing = false;
    if (event.button === 2) this.setAiming(false);
  };

  private readonly onPointerLockChange = (): void => {
    if (document.pointerLockElement === this.canvas) {
      this.pointerLockPending = false;
      this.fallbackLookActive = false;
      this.controlsActive = true;
      this.combatGraceEndsAt = Math.max(this.combatGraceEndsAt, performance.now() / 1000 + 6);
      this.callbacks.onControlCapture(true);
      this.callbacks.onControlStatus('视角控制：鼠标已锁定 · 移动鼠标转向 · Esc 退出');
      return;
    }
    this.pointerLockPending = false;
    this.controlsActive = false;
    this.fallbackLookActive = false;
    this.releaseHeldInputs();
    this.callbacks.onControlCapture(false);
    if (this.run.phase === 'active' || this.run.phase === 'extracting') {
      this.callbacks.onControlStatus('视角控制：鼠标未锁定 · 点击画面重新进入');
    }
  };

  private readonly onPointerLockError = (): void => {
    this.pointerLockPending = false;
    // Keep the run playable when Pointer Lock is unavailable (common in
    // embedded previews and some trackpad/browser combinations). The game
    // shell hides the cursor while this mode is active; client deltas drive
    // the same camera look code as locked mouse movement.
    this.fallbackLookActive = true;
    this.controlsActive = true;
    this.callbacks.onControlCapture(true);
    this.callbacks.onControlStatus('视角控制：触控板模式 · 移动鼠标转向 · Esc 退出');
    this.callbacks.onToast('已切换触控板视角模式', 'info');
  };

  private requestLookLock(): void {
    if (this.pointerLockPending) return;
    this.pointerLockPending = true;
    this.canvas.focus();
    if (!this.canvas.requestPointerLock) {
      this.onPointerLockError();
      return;
    }
    try {
      const result = this.canvas.requestPointerLock();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        void (result as Promise<void>).catch(this.onPointerLockError);
      }
      window.setTimeout(() => {
        if (this.pointerLockPending && document.pointerLockElement !== this.canvas) this.onPointerLockError();
      }, 700);
    } catch {
      this.onPointerLockError();
    }
  }

  private applyLook(deltaX: number, deltaY: number, sensitivity: number): void {
    this.yaw -= deltaX * sensitivity;
    this.pitch -= deltaY * sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.42, 1.42);
    this.lookSwayX = THREE.MathUtils.clamp(this.lookSwayX + deltaX * sensitivity * 0.16, -0.075, 0.075);
    this.lookSwayY = THREE.MathUtils.clamp(this.lookSwayY + deltaY * sensitivity * 0.1, -0.055, 0.055);
  }

  private isActionCode(code: string, action: GameAction): boolean {
    return this.settings.keyBindings[action] === code;
  }

  private isActionDown(action: GameAction): boolean {
    return this.keys.has(this.settings.keyBindings[action]);
  }

  private createAbilityView(now = this.run.elapsedSeconds): AbilityView {
    return {
      smokeCooldown: abilitySecondsRemaining(now, this.smokeCooldownEndsAt),
      smokeActive: this.smokes.reduce((remaining, smoke) => Math.max(remaining, abilitySecondsRemaining(now, smoke.endsAt)), 0),
      adrenalineCooldown: abilitySecondsRemaining(now, this.adrenalineCooldownEndsAt),
      adrenalineActive: abilitySecondsRemaining(now, this.adrenalineEndsAt),
      runCooldown: abilitySecondsRemaining(now, this.runCooldownEndsAt),
      runActive: abilitySecondsRemaining(now, this.runEndsAt),
    };
  }

  private emitAbilityView(now = this.run.elapsedSeconds): void {
    this.callbacks.onAbilities?.(this.createAbilityView(now));
  }

  private deploySmoke(force = false): void {
    if (!['active', 'extracting'].includes(this.run.phase) || (!force && !this.controlsActive) || this.lootSearch) return;
    const now = this.run.elapsedSeconds;
    if (!isAbilityReady(now, this.smokeCooldownEndsAt)) {
      this.callbacks.onToast(`烟幕冷却中 · ${Math.ceil(this.smokeCooldownEndsAt - now)} 秒`);
      return;
    }

    const forward = this.camera.getWorldDirection(new THREE.Vector3()).setY(0);
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
    forward.normalize();
    const player = this.playerBody.translation();
    const position = new THREE.Vector3(player.x, player.y + 0.5, player.z).addScaledVector(forward, 6);
    const particleCount = this.qualityLevel === 'low' ? 16 : this.qualityLevel === 'medium' ? 20 : 26;
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.PointsMaterial({
      color: '#c2cac4',
      map: this.getSmokeTexture(),
      size: this.qualityLevel === 'low' ? 2.8 : 3.35,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.03,
      depthWrite: false,
      alphaTest: 0.015,
    });
    const positions = new Float32Array(particleCount * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    const mesh = new THREE.Points(geometry, material);
    mesh.position.copy(position);
    mesh.layers.set(MAP_RENDER_LAYERS[this.activeOperation.id]);
    mesh.renderOrder = 4;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const particles: SmokeParticle[] = [];
    for (let index = 0; index < particleCount; index += 1) {
      const angle = index * 2.399963 + (index % 3) * 0.17;
      const radius = 0.35 + (index % 7) / 6 * 3.35;
      const offset = new THREE.Vector3(
        Math.cos(angle) * radius,
        -0.65 + (index % 6) * 0.48,
        Math.sin(angle) * radius,
      );
      const scale = 1.25 + (index % 5) * 0.19;
      particles.push({ offset, scale, drift: 0.35 + (index % 4) * 0.13 });
      positions[index * 3] = offset.x;
      positions[index * 3 + 1] = offset.y;
      positions[index * 3 + 2] = offset.z;
    }
    geometry.getAttribute('position').needsUpdate = true;
    this.scene.add(mesh);
    this.smokes.push({ mesh, position, particles, startedAt: now, endsAt: now + SMOKE_DURATION, radius: SMOKE_RADIUS });
    this.smokeCooldownEndsAt = now + SMOKE_COOLDOWN;
    this.audio.smokeDeploy(position);
    this.callbacks.onToast('烟幕已投放 · 敌方视线受阻');
    this.emitAbilityView(now);
  }

  private useAdrenaline(force = false): void {
    if (!['active', 'extracting'].includes(this.run.phase) || (!force && !this.controlsActive) || this.lootSearch) return;
    const now = this.run.elapsedSeconds;
    if (!isAbilityReady(now, this.adrenalineCooldownEndsAt)) {
      this.callbacks.onToast(`肾上腺素冷却中 · ${Math.ceil(this.adrenalineCooldownEndsAt - now)} 秒`);
      return;
    }
    this.adrenalineEndsAt = now + ADRENALINE_DURATION;
    this.adrenalineCooldownEndsAt = now + ADRENALINE_COOLDOWN;
    this.adrenalineHealingRemaining = ADRENALINE_TOTAL_HEALING;
    this.run.player.stamina = 100;
    this.audio.adrenaline();
    this.callbacks.onToast('肾上腺素生效 · 加速并持续恢复生命');
    this.emitAbilityView(now);
  }

  private activateRun(force = false): void {
    if (!['active', 'extracting'].includes(this.run.phase) || (!force && !this.controlsActive) || this.lootSearch) return;
    const now = this.run.elapsedSeconds;
    if (!isAbilityReady(now, this.runCooldownEndsAt)) {
      this.callbacks.onToast(`快速冲刺冷却中 · ${Math.ceil(this.runCooldownEndsAt - now)} 秒`);
      return;
    }
    this.runEndsAt = now + RUN_DURATION;
    this.runCooldownEndsAt = now + RUN_COOLDOWN;
    this.run.player.stamina = Math.max(0, this.run.player.stamina - 12);
    this.callbacks.onToast('快速冲刺 · 短距离突进');
    this.emitAbilityView(now);
  }

  private updateAbilities(delta: number, now: number): void {
    if (now < this.adrenalineEndsAt) {
      const healed = applyAdrenalineHealing(this.run.player.health, this.adrenalineHealingRemaining, delta);
      this.run.player.health = healed.health;
      this.adrenalineHealingRemaining = healed.healingRemaining;
    } else {
      this.adrenalineHealingRemaining = 0;
    }
    this.updateSmokeEffects(now);
  }

  private updateSmokeEffects(now: number): void {
    for (let smokeIndex = this.smokes.length - 1; smokeIndex >= 0; smokeIndex -= 1) {
      const smoke = this.smokes[smokeIndex];
      if (now >= smoke.endsAt) {
        this.scene.remove(smoke.mesh);
        this.disposeDynamicObject(smoke.mesh);
        this.smokes.splice(smokeIndex, 1);
        continue;
      }
      const age = now - smoke.startedAt;
      const remaining = smoke.endsAt - now;
      const bloom = THREE.MathUtils.smoothstep(age, 0, 1.15);
      const fade = THREE.MathUtils.smoothstep(remaining, 0, 2.4);
      smoke.mesh.material.opacity = 0.42 * Math.min(bloom, fade);
      const positions = smoke.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      smoke.particles.forEach((particle, index) => {
        const swirl = age * particle.drift + index * 0.53;
        const spread = 0.34 + bloom * 0.66;
        positions.setXYZ(
          index,
          particle.offset.x * spread + Math.sin(swirl) * 0.26 * bloom,
          particle.offset.y * spread + Math.min(1.15, age * 0.055) + Math.sin(swirl * 0.61) * 0.12,
          particle.offset.z * spread + Math.cos(swirl * 0.83) * 0.26 * bloom,
        );
      });
      positions.needsUpdate = true;
    }
  }

  private getSmokeTexture(): THREE.CanvasTexture {
    if (this.smokeTexture) return this.smokeTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    if (context) {
      const gradient = context.createRadialGradient(48, 48, 4, 48, 48, 47);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
      gradient.addColorStop(0.3, 'rgba(238, 243, 240, 0.72)');
      gradient.addColorStop(0.68, 'rgba(205, 216, 210, 0.28)');
      gradient.addColorStop(1, 'rgba(185, 198, 191, 0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 96, 96);
    }
    this.smokeTexture = new THREE.CanvasTexture(canvas);
    this.smokeTexture.colorSpace = THREE.SRGBColorSpace;
    return this.smokeTexture;
  }

  private clearAbilities(): void {
    for (const smoke of this.smokes) {
      this.scene.remove(smoke.mesh);
      this.disposeDynamicObject(smoke.mesh);
    }
    this.smokes.length = 0;
    this.smokeCooldownEndsAt = 0;
    this.adrenalineCooldownEndsAt = 0;
    this.adrenalineEndsAt = 0;
    this.adrenalineHealingRemaining = 0;
    this.runCooldownEndsAt = 0;
    this.runEndsAt = 0;
    this.emitAbilityView(0);
  }

  private pauseRun(): void {
    if (!['active', 'extracting'].includes(this.run.phase)) return;
    this.run.phase = 'paused';
    this.releaseHeldInputs();
    this.controlsActive = false;
    this.fallbackLookActive = false;
    this.pointerLockPending = false;
    this.cancelLootSearch();
    this.callbacks.onControlCapture(false);
    this.callbacks.onPause();
    this.callbacks.onUpdate(this.run);
  }

  private setAiming(active: boolean): void {
    if (active && this.carriedObjective) return;
    if (active && (this.weaponAction !== 'idle' || this.run.player.weapon.reloading || this.weaponWallBlocked || this.sprintBlend > 0.16)) return;
    if (this.aiming === active) return;
    this.aiming = active;
    if (this.weaponScope) this.weaponScope.visible = this.activeWeaponId !== 'shotgun' && !active;
    if (this.weaponSight) this.weaponSight.visible = !active;
    this.callbacks.onAiming(active);
  }

  private resetWeaponLoadout(startingWeapon: WeaponId = 'rifle'): void {
    this.weaponStates = new Map<WeaponId, WeaponState>([
      ['rifle', { magazine: 30, reserve: 90, reloading: false, reloadEndsAt: 0 }],
      ['smg', { magazine: 36, reserve: 108, reloading: false, reloadEndsAt: 0 }],
      ['shotgun', { magazine: 8, reserve: 32, reloading: false, reloadEndsAt: 0 }],
    ]);
    this.activeWeaponId = WEAPON_CONFIGS[startingWeapon] ? startingWeapon : 'rifle';
    this.run.player.weapon = this.weaponStates.get(this.activeWeaponId)!;
    this.applyWeaponVisual();
    this.callbacks.onWeaponChange(this.getWeaponConfig(this.activeWeaponId));
  }

  private switchWeapon(id: WeaponId): void {
    if (!['active', 'extracting', 'deploying'].includes(this.run.phase)) return;
    if (!this.availableWeapons.has(id)) {
      this.callbacks.onToast(this.activeGameMode === 'zero' ? '尚未在局内取得这把武器' : '本模式禁止使用这把武器', 'danger');
      return;
    }
    if (this.carriedObjective) {
      this.callbacks.onToast('正在押运货箱，无法切换武器', 'danger');
      return;
    }
    if (this.activeWeaponId === id) return;
    const current = this.weaponStates.get(this.activeWeaponId);
    if (current) {
      current.reloading = false;
      current.reloadEndsAt = 0;
    }
    this.reloadStage = 0;
    this.activeWeaponId = id;
    this.run.player.weapon = this.weaponStates.get(id)!;
    if (this.activeGameMode === 'training') {
      this.run.player.weapon.magazine = 999;
      this.run.player.weapon.reserve = 999;
    }
    this.setAiming(false);
    const now = performance.now() / 1000;
    this.weaponAction = 'switch';
    this.weaponActionStartedAt = now;
    this.weaponActionEndsAt = now + 0.48;
    this.nextShotAt = this.weaponActionEndsAt;
    this.recoilShotIndex = 0;
    this.shotSway = 0;
    this.applyWeaponVisual();
    this.callbacks.onWeaponChange(this.getWeaponConfig(id));
    this.callbacks.onUpdate(this.run);
    this.audio.weaponAction('switch');
    this.callbacks.onToast(`已切换 ${this.getWeaponConfig(id).name}`);
  }

  private startInspect(): void {
    if (!['active', 'extracting'].includes(this.run.phase)) return;
    if (this.run.player.weapon.reloading || this.weaponAction !== 'idle') return;
    const now = performance.now() / 1000;
    this.firing = false;
    this.setAiming(false);
    this.weaponAction = 'inspect';
    this.weaponActionStartedAt = now;
    this.weaponActionEndsAt = now + 2.2;
    this.audio.weaponAction('inspect');
    this.callbacks.onToast(`检视 ${this.getWeaponConfig(this.activeWeaponId).name}`);
  }

  private getWeaponConfig(id: WeaponId): WeaponConfig {
    const base = WEAPON_CONFIGS[id];
    const tuning = this.weaponTunings[id];
    if (!tuning) return base;
    return {
      ...base,
      magazineSize: Math.max(1, base.magazineSize + tuning.magazineBonus),
      reserve: Math.max(0, base.reserve + tuning.reserveBonus),
      hipSpread: base.hipSpread * tuning.spreadMultiplier,
      aimSpread: base.aimSpread * tuning.spreadMultiplier,
      reloadDuration: Math.max(0.65, base.reloadDuration * tuning.reloadMultiplier),
      recoil: base.recoil * tuning.recoilMultiplier,
      aimFov: THREE.MathUtils.clamp(base.aimFov + tuning.aimFovDelta, 18, 66),
      shotVolume: base.shotVolume * Math.sqrt(tuning.noiseMultiplier),
      noiseRadius: base.noiseRadius * tuning.noiseMultiplier,
      suppressor: base.suppressor || tuning.noiseMultiplier < 0.8,
    };
  }

  private buildEnvironment(): void {
    this.scene.background = new THREE.Color('#a9c0c2');
    this.scene.fog = new THREE.FogExp2('#aabbb6', 0.00235);

    this.hemisphere = new THREE.HemisphereLight('#eef8f3', '#485247', 1.65);
    this.scene.add(this.hemisphere);
    this.sun = new THREE.DirectionalLight('#fff1d0', 3.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 330;
    this.sun.shadow.bias = -0.00008;
    this.sun.shadow.normalBias = 0.018;
    this.sun.target = this.sunTarget;
    this.scene.add(this.sun, this.sunTarget);
    this.focusSunOnOperation('harbor');

    const asphaltTexture = this.makeTexture('asphalt', '#5b6059', '#343a34');
    const concreteTexture = this.makeTexture('concrete', '#b6b4a8', '#85867f');
    const metalTexture = this.makeTexture('metal', '#778078', '#3e4941');
    const asphalt = new THREE.MeshStandardMaterial({
      color: '#9ca39b',
      map: asphaltTexture,
      bumpMap: asphaltTexture,
      bumpScale: 0.13,
      roughness: 0.86,
      metalness: 0.02,
    });
    const concrete = new THREE.MeshStandardMaterial({
      color: '#dad8cf',
      map: concreteTexture,
      bumpMap: concreteTexture,
      bumpScale: 0.1,
      roughness: 0.78,
    });
    const darkMetal = new THREE.MeshStandardMaterial({
      color: '#65736a', map: metalTexture, bumpMap: metalTexture, bumpScale: 0.055, roughness: 0.62, metalness: 0.45,
    });
    const roofMetal = new THREE.MeshStandardMaterial({
      color: '#a1aca4',
      map: metalTexture,
      bumpMap: metalTexture,
      bumpScale: 0.07,
      roughness: 0.42,
      metalness: 0.68,
    });

    const waterMaterial = new THREE.MeshPhysicalMaterial({
      color: '#2b7e8b',
      roughness: 0.2,
      metalness: 0.08,
      clearcoat: 0.72,
      clearcoatRoughness: 0.18,
      transparent: true,
      opacity: 0.92,
    });
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(240, 200, 1, 1), waterMaterial);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = -1.16;
    this.water.receiveShadow = true;
    this.scene.add(this.water);

    const shore = new THREE.MeshStandardMaterial({ color: '#b7a276', roughness: 0.96, metalness: 0.02 });
    this.addBox(0, -0.75, 0, 116, 0.35, 88, shore, false);
    this.addBox(0, -0.55, 0, 108, 1, 150, asphalt, true);
    const seawall = new THREE.MeshStandardMaterial({ color: '#8b9690', roughness: 0.68, metalness: 0.24 });
    this.addBox(0, 0.15, -41.6, 108, 1.05, 0.8, seawall, true);
    this.addBox(-53.6, 0.15, 0, 0.8, 1.05, 82, seawall, true);
    this.addBox(53.6, 0.15, 0, 0.8, 1.05, 82, seawall, true);
    this.addBox(-27, 0.15, 41.6, 52, 1.05, 0.8, seawall, true);
    this.addBox(14, 0.15, 41.6, 26, 1.05, 0.8, seawall, true);

    const bridgeMaterial = new THREE.MeshStandardMaterial({ color: '#9a9a86', roughness: 0.78, metalness: 0.28 });
    this.addBox(44, -0.42, -50.8, 13, 0.5, 18, bridgeMaterial, true);
    this.addBox(44, -0.4, -73, 29, 0.62, 26, concrete, true);
    for (const x of [38, 50]) {
      this.addBox(x, 0.62, -50.8, 0.25, 1.3, 18, seawall, true);
    }

    const lineMaterial = new THREE.MeshBasicMaterial({ color: '#c6b956' });
    for (let z = -44; z <= 42; z += 12) {
      this.addBox(13, 0.015, z, 0.16, 0.025, 5, lineMaterial, false, false);
    }

    this.buildWarehouse(concrete, roofMetal, darkMetal);
    this.buildIslandBuildings(concrete, roofMetal, darkMetal);
    this.buildContainers();
    this.buildCheckpoint(concrete, darkMetal);
    this.buildCrane(darkMetal);
    this.buildHarborDetails(darkMetal);
    this.addSetDressing(concrete, darkMetal);
    this.assignSceneChildrenToLayer(0, MAP_RENDER_LAYERS.harbor);
    this.buildExtendedOperations(concrete, roofMetal, darkMetal);
    const administrationStart = this.scene.children.length;
    this.buildAdministrationDistrict(concrete, roofMetal, darkMetal);
    this.assignSceneChildrenToLayer(administrationStart, MAP_RENDER_LAYERS.administration);
    const reservoirStart = this.scene.children.length;
    this.buildReservoirDistrict(concrete, roofMetal, darkMetal, asphalt);
    this.assignSceneChildrenToLayer(reservoirStart, MAP_RENDER_LAYERS.reservoir);
    this.buildVisualDetailPass(darkMetal);
    this.addInteriorLights();
    this.addDestructibleDetails();
    this.organizeMapRenderRoots();
  }

  private assignSceneChildrenToLayer(startIndex: number, layer: number): void {
    for (let index = startIndex; index < this.scene.children.length; index += 1) {
      this.scene.children[index].traverse((object) => {
        if (!(object as THREE.Mesh).isMesh && !(object as THREE.Points).isPoints) return;
        object.layers.set(layer);
      });
    }
  }

  private organizeMapRenderRoots(): void {
    const mapEntries = Object.entries(MAP_RENDER_LAYERS) as Array<[MapId, number]>;
    const roots = new Map<MapId, THREE.Group>();
    for (const [mapId] of mapEntries) {
      const root = new THREE.Group();
      root.name = `map-render-root-${mapId}`;
      root.matrixAutoUpdate = false;
      root.updateMatrix();
      roots.set(mapId, root);
    }

    for (const child of [...this.scene.children]) {
      const childMaps = new Set<MapId>();
      child.traverse((object) => {
        if (
          !(object as THREE.Mesh).isMesh
          && !(object as THREE.Points).isPoints
          && !(object as THREE.Line).isLine
          && !(object as THREE.Sprite).isSprite
        ) return;
        for (const [mapId, layer] of mapEntries) {
          if (object.layers.isEnabled(layer)) childMaps.add(mapId);
        }
      });
      if (childMaps.size !== 1) continue;
      const [mapId] = childMaps;
      roots.get(mapId)?.add(child);
    }

    for (const [mapId, root] of roots) {
      if (root.children.length === 0) continue;
      this.scene.add(root);
      this.mapRenderRoots.set(mapId, root);
    }
    this.updateMapRenderRootVisibility(this.activeOperation.id);
  }

  private updateMapRenderRootVisibility(activeMapId: MapId): void {
    for (const [mapId, root] of this.mapRenderRoots) root.visible = mapId === activeMapId;
  }

  private focusSunOnOperation(mapId: MapId = this.activeOperation.id): void {
    if (!this.sun) return;
    this.updateMapRenderRootVisibility(mapId);
    const renderLayer = MAP_RENDER_LAYERS[mapId];
    this.camera.layers.disableAll();
    this.camera.layers.enable(0);
    this.camera.layers.enable(renderLayer);
    this.sun.shadow.camera.layers.disableAll();
    this.sun.shadow.camera.layers.enable(0);
    this.sun.shadow.camera.layers.enable(renderLayer);
    const centers: Record<MapId, { x: number; z: number; range: number }> = {
      harbor: { x: 0, z: 0, range: 105 },
      radar: { x: -76, z: 0, range: 105 },
      refinery: { x: 78, z: 0, range: 110 },
      administration: { x: 165, z: 92, range: 88 },
      reservoir: { x: 400, z: 0, range: 180 },
    };
    const center = centers[mapId];
    this.sun.color.set(mapId === 'administration' ? '#ffd9a0' : '#fff1d0');
    this.sun.intensity = mapId === 'administration' ? 4.25 : 3.9;
    this.hemisphere.color.set(mapId === 'administration' ? '#ddecff' : '#eef8f3');
    this.hemisphere.groundColor.set(mapId === 'administration' ? '#45534b' : '#485247');
    this.hemisphere.intensity = mapId === 'administration' ? 1.35 : 1.65;
    this.sun.position.set(center.x - 52, 78, center.z + 44);
    this.sunTarget.position.set(center.x, 0, center.z);
    this.sunShadowFocus.set(center.x, 0, center.z);
    this.sunTarget.updateMatrixWorld();
    this.sun.shadow.camera.left = -center.range;
    this.sun.shadow.camera.right = center.range;
    this.sun.shadow.camera.top = center.range;
    this.sun.shadow.camera.bottom = -center.range;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
  }

  private updateAdministrationShadowFocus(force = false): void {
    if (this.activeOperation.id !== 'administration' || !this.sun) return;
    const x = THREE.MathUtils.clamp(this.camera.position.x, 112, 218);
    const z = THREE.MathUtils.clamp(this.camera.position.z, -146, 156);
    const focusDx = x - this.sunShadowFocus.x;
    const focusDz = z - this.sunShadowFocus.z;
    if (!force && focusDx * focusDx + focusDz * focusDz < 22 ** 2) return;
    this.sun.position.set(x - 52, 78, z + 44);
    this.sunTarget.position.set(x, 0, z);
    this.sunTarget.updateMatrixWorld();
    this.sunShadowFocus.set(x, 0, z);
    this.renderer.shadowMap.needsUpdate = true;
  }

  private buildVisualDetailPass(metal: THREE.Material): void {
    const safety = new THREE.MeshStandardMaterial({ color: '#d6ad35', roughness: 0.58, metalness: 0.3 });
    for (const x of [-34, -29, -24, -12, -7, -2]) {
      this.addBox(x, 4.2, 4.42, 0.18, 7.3, 0.14, metal, false, false);
    }
    this.addBox(-18, 6.75, 4.45, 33, 0.28, 0.16, safety, false, false);

    this.addWorldSign('A-01  主仓库', -18, 5.7, 4.58, 8.6, 1.35, 0, '#26352f', '#d6e86b');
    this.addWorldSign('长风雷达站', -72, 5.35, -31.12, 7.2, 1.18, Math.PI, '#263a36', '#91d0c4');
    this.addWorldSign('赤湾控制区', 72, 5.5, -22.12, 7.2, 1.18, Math.PI, '#442f29', '#e3b24e');
    this.addWorldSign('行政主楼', 165, 10.1, -39.62, 9, 1.4, 0, '#3d2422', '#e7c45c');
    this.addWorldSign('黑峡发电站', 449, 6.5, -63.12, 8, 1.25, Math.PI, '#263532', '#9bd1bd');

    this.addInstancedCrates();
    this.addIndustrialLights(metal);

    const pipeMaterials = [
      new THREE.MeshStandardMaterial({ color: '#9e4538', roughness: 0.52, metalness: 0.5 }),
      new THREE.MeshStandardMaterial({ color: '#d0a52c', roughness: 0.5, metalness: 0.48 }),
      new THREE.MeshStandardMaterial({ color: '#6a847b', roughness: 0.46, metalness: 0.58 }),
    ];
    const pipes: Array<[number, number, number, number, 'x' | 'z', number]> = [
      [78, 4.3, -25, 38, 'x', 0], [82, 5.5, 18, 48, 'x', 1],
      [105, 3.6, -23, 28, 'z', 2], [54, 3, -29, 22, 'z', 1],
    ];
    for (const [x, y, z, length, axis, materialIndex] of pipes) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, length, 14), pipeMaterials[materialIndex]);
      pipe.position.set(x, y, z);
      if (axis === 'x') pipe.rotation.z = Math.PI / 2;
      else pipe.rotation.x = Math.PI / 2;
      pipe.castShadow = true;
      pipe.receiveShadow = true;
      this.scene.add(pipe);
    }
    for (const [x, z] of [[60,-25],[72,-25],[84,-25],[96,-25],[64,18],[80,18],[96,18]] as const) {
      this.addBox(x, 2.1, z, 0.18, 4.2, 0.18, metal, false, false);
    }
  }

  private addWorldSign(
    label: string,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    rotationY: number,
    background: string,
    accent: string,
  ): void {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 144;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = accent;
    context.fillRect(0, 0, 18, canvas.height);
    context.fillRect(0, canvas.height - 9, canvas.width, 9);
    context.strokeStyle = 'rgba(255,255,255,0.3)';
    context.lineWidth = 3;
    context.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
    context.fillStyle = '#f4f6e9';
    context.font = '700 58px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, canvas.width / 2 + 8, canvas.height / 2 - 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    );
    sign.position.set(x, y, z);
    sign.rotation.y = rotationY;
    this.scene.add(sign);
  }

  private addInstancedCrates(): void {
    const geometry = new THREE.BoxGeometry(1.4, 1, 1.2);
    const materials = ['#806c50', '#586f67', '#875744'].map((color) => (
      new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.12 })
    ));
    for (const material of materials) material.userData.surface = 'wood';
    const placements: Array<[number, number, number, number]> = [
      [-42,0.5,34,0],[-40.45,0.5,34,0],[-41.2,1.5,34,0.08],[20,0.5,35,0.2],[21.5,0.5,35,0.2],[-10,0.5,12,0.7],
      [-103,0.5,35,0.2],[-89,0.5,30,0.8],[-57,0.5,20,0.1],[-58.5,0.5,20,0.1],
      [106,0.5,40,0.4],[104.5,0.5,40,0.4],[54,0.5,-10,0.9],[87,0.5,32,0],
      [126,0.5,40,0.2],[204,0.5,40,-0.2],[150,0.5,18,0.5],[180,0.5,-18,0.7],
      [275,0.5,100,0.2],[305,0.5,64,0.7],[425,0.5,45,0.1],[500,0.5,60,0.8],[470,0.5,-35,0.35],
    ];
    const meshes = materials.map((material) => {
      const mesh = new THREE.InstancedMesh(geometry, material, Math.ceil(placements.length / materials.length));
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.blockers.push(mesh);
      return mesh;
    });
    const counts = [0, 0, 0];
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    placements.forEach(([x, y, z, rotation], index) => {
      const materialIndex = index % materials.length;
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
      matrix.compose(new THREE.Vector3(x, y, z), quaternion, new THREE.Vector3(1, 1, 1));
      meshes[materialIndex].setMatrixAt(counts[materialIndex], matrix);
      counts[materialIndex] += 1;
      meshes[materialIndex].count = counts[materialIndex];
      this.addStaticRotatedCollider(x, y, z, 1.4, 1, 1.2, rotation);
    });
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  }

  private addIndustrialLights(metal: THREE.Material): void {
    const positions = [
      [-46,38],[-22,38],[8,38],[38,38],[-46,-5],[10,-17],[41,-18],
      [-100,8],[-61,4],[56,20],[101,5],[150,44],[180,44],[280,106],[430,106],[510,68],
    ] as const;
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.11, 5.2, 8), metal, positions.length);
    const lamps = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.75, 0.16, 0.32),
      new THREE.MeshBasicMaterial({ color: '#dff2c1' }),
      positions.length,
    );
    const matrix = new THREE.Matrix4();
    positions.forEach(([x, z], index) => {
      matrix.makeTranslation(x, 2.6, z);
      poles.setMatrixAt(index, matrix);
      matrix.makeTranslation(x + 0.28, 5.12, z);
      lamps.setMatrixAt(index, matrix);
    });
    poles.instanceMatrix.needsUpdate = true;
    lamps.instanceMatrix.needsUpdate = true;
    poles.castShadow = true;
    this.scene.add(poles, lamps);
  }

  private addInteriorLights(): void {
    const lights: Array<[MapId, number, number, number, string, number, number]> = [
      ['harbor', -31, 4.8, -8, '#ffe2aa', 1.8, 17],
      ['harbor', -18, 4.8, -8, '#ffe2aa', 1.8, 17],
      ['harbor', -5, 4.8, -8, '#ffe2aa', 1.8, 17],
      ['radar', -72, 4.2, -8, '#c9f0df', 1.55, 15],
      ['radar', -92, 3.5, 20, '#d7f1e7', 1.35, 13],
      ['refinery', 72, 4.5, 2, '#ffc174', 1.7, 16],
      ['refinery', 91, 4.2, -21, '#ffb05d', 1.5, 15],
      ['administration', 151, 3.3, -27, '#ffe4b5', 1.75, 17],
      ['administration', 179, 3.3, -27, '#ffe4b5', 1.75, 17],
      ['administration', 165, 7.2, -32, '#d9edff', 1.5, 16],
      ['administration', 123, 3.8, 139, '#ffe0b0', 1.55, 18],
      ['administration', 207, 3.8, 134, '#d8ebff', 1.45, 18],
      ['administration', 123, 3.7, -129, '#ffe2b8', 1.5, 18],
      ['administration', 207, 3.9, -127, '#d8ebff', 1.5, 18],
      ['administration', 165, 3.5, -141, '#ffe0a3', 1.45, 20],
      ['reservoir', 449, 3.9, -48, '#c8f3d4', 1.55, 17],
      ['reservoir', 467, 3.6, -68, '#c8f3d4', 1.45, 16],
    ];
    for (const [mapId, x, y, z, color, intensity, distance] of lights) {
      const light = new THREE.PointLight(color, intensity, distance, 2);
      light.position.set(x, y, z);
      light.visible = false;
      light.userData.mapId = mapId;
      light.layers.enable(MAP_RENDER_LAYERS[mapId]);
      this.scene.add(light);
      this.staticPointLights.push(light);

      const fixture = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.09, 0.3),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.7, roughness: 0.3 }),
      );
      fixture.position.set(x, y + 0.12, z);
      fixture.layers.set(MAP_RENDER_LAYERS[mapId]);
      this.scene.add(fixture);
    }
  }

  private addStaticRotatedCollider(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    rotationY: number,
  ): void {
    const body = this.physicsWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(x, y, z)
        .setRotation({ x: 0, y: Math.sin(rotationY / 2), z: 0, w: Math.cos(rotationY / 2) }),
    );
    this.physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2), body);
  }

  private buildReservoirDistrict(
    concrete: THREE.Material,
    roof: THREE.Material,
    metal: THREE.Material,
    asphalt: THREE.Material,
  ): void {
    const rock = new THREE.MeshStandardMaterial({ color: '#596252', roughness: 0.98, flatShading: true });
    const darkRock = new THREE.MeshStandardMaterial({ color: '#41493f', roughness: 1, flatShading: true });
    const soil = new THREE.MeshStandardMaterial({ color: '#68705b', roughness: 0.97 });
    const tunnel = new THREE.MeshStandardMaterial({ color: '#676f69', roughness: 0.86, metalness: 0.12 });
    const safety = new THREE.MeshStandardMaterial({ color: '#d0a42e', roughness: 0.62, metalness: 0.24 });
    const glass = new THREE.MeshStandardMaterial({ color: '#73a6a2', emissive: '#123b38', emissiveIntensity: 0.9, roughness: 0.2 });

    // The zone covers roughly 290 x 250 metres. The ground is split into districts so the
    // reservoir and the two tunnel entrances remain physically open.
    this.addBox(295, -0.55, 104, 70, 1.1, 42, soil, true);
    this.addGroundSlabWithHole(
      295, 3, 70, 134, 310, 24,
      RESERVOIR_TUNNEL_OPENING_WIDTH, RESERVOIR_TUNNEL_OPENING_DEPTH,
      soil,
    );
    this.addGroundSlabWithHole(
      465, 104, 150, 42, 438, 105,
      RESERVOIR_TUNNEL_OPENING_WIDTH, RESERVOIR_TUNNEL_OPENING_DEPTH,
      soil,
    );
    this.addBox(465, -0.55, -27, 150, 1.1, 196, soil, true);
    this.addBox(375, -0.55, 101, 100, 1.1, 48, soil, true);
    this.addBox(375, -0.55, -102, 100, 1.1, 46, soil, true);

    // Close the long seams between the district slabs and the tunnel roof. Only the
    // four ramp lanes remain open, so every surface that looks walkable is supported.
    this.addBox(405, -0.55, 72, 270, 1.1, 4, soil, true);
    this.addBox(405, -0.55, 82.7, 270, 1.1, 0.8, soil, true);
    this.addBox(253.5, -0.55, 74.65, 35, 1.1, 1.3, soil, true);
    this.addBox(253.5, -0.55, 81.5, 35, 1.1, 1.6, soil, true);
    this.addBox(454.5, -0.55, 72.5, 11.4, 1.1, 3, soil, true);
    this.addBox(454.5, -0.55, 81.9, 11.4, 1.1, 2.2, soil, true);
    this.addBox(500, -0.55, 77, 80.4, 1.1, 12.2, soil, true);

    const lake = new THREE.Mesh(
      new THREE.PlaneGeometry(88, 144, 1, 1),
      new THREE.MeshPhysicalMaterial({
        color: '#2b6670', roughness: 0.18, clearcoat: 0.8, clearcoatRoughness: 0.16,
        transparent: true, opacity: 0.9, metalness: 0.06,
      }),
    );
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(375, -0.3, -6);
    lake.receiveShadow = true;
    this.scene.add(lake);
    // The reservoir is shallow rather than an endless hole. This also protects
    // players who step off a bank or the end of a service road.
    this.addBox(375, -0.71, -6, 88, 0.12, 144, darkRock, true, false);

    // A broad dam and two drivable-width service bridges connect both banks.
    this.addBox(375, 2.9, -78, 92, 6, 8, concrete, true);
    this.addBox(375, 6.15, -78, 94, 0.5, 10, asphalt, true);
    this.addBox(375, 0.45, 58, 94, 0.9, 7, concrete, true);
    for (const x of [341, 359, 377, 395, 413]) {
      this.addBox(x, 4.8, -73.6, 0.45, 2.2, 0.45, safety, false);
      this.addBox(x, 4.8, -82.4, 0.45, 2.2, 0.45, safety, false);
    }
    for (const x of [350, 370, 390, 410]) {
      this.addBox(x, 3, -78, 7.5, 4.7, 1.4, metal, true);
    }

    // Major landmarks make the large map readable without copying the reference layout.
    // Keep the deployment lane to the western tunnel entrance completely open.
    this.buildBlockBuilding(310, 91, 25, 18, 7, concrete, roof, glass);
    this.buildBlockBuilding(320, 38, 30, 24, 8, concrete, roof, glass);
    this.buildBlockBuilding(449, -48, 38, 30, 10, concrete, roof, glass);
    this.buildBlockBuilding(486, 47, 34, 25, 8, metal, roof, glass);
    this.buildBlockBuilding(452, -72, 24, 15, 6.5, concrete, roof, glass);
    this.buildBlockBuilding(510, -35, 22, 18, 6, metal, roof, glass);

    const turbineMaterial = new THREE.MeshStandardMaterial({ color: '#9aa69b', roughness: 0.48, metalness: 0.62 });
    for (const x of [433, 448, 463]) {
      const turbine = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 8, 24), turbineMaterial);
      turbine.position.set(x, 4, -62);
      turbine.castShadow = true;
      this.scene.add(turbine);
      this.blockers.push(turbine);
      this.addStaticCollider(x, 4, -62, 8.2, 8, 8.2);
    }

    // Curving roads are approximated with short, angled slabs for a less blocky landscape.
    const roadSegments: Array<[number, number, number]> = [
      [270,105,-0.2],[292,88,-0.45],[310,68,-0.7],[328,51,-0.5],[350,36,-0.25],
      [410,43,0.28],[432,55,0.2],[458,68,-0.12],[486,72,-0.42],[511,58,-0.7],
      [521,31,-1.15],[514,2,-1.42],[501,-22,-1.05],[486,-41,-0.75],
    ];
    for (const [x, z, rotation] of roadSegments) {
      this.addRotatedBox(x, 0.08, z, 30, 0.16, 7, asphalt, rotation, true, false);
    }

    this.buildReservoirRidgeRoutes(soil, rock, darkRock);

    // Mountain walls frame the playable area while leaving multiple road approaches.
    const mountains: Array<[number, number, number, number, number]> = [
      [242,118,25,20,22],[238,75,22,17,27],[239,26,28,22,25],[241,-24,25,19,29],[250,-76,35,25,31],
      [282,-118,38,27,24],[330,-126,30,22,22],[432,-128,34,26,23],[490,-126,38,28,24],[540,-102,30,25,32],
      [552,-52,24,20,28],[555,0,28,23,28],[555,56,28,22,30],[548,110,34,25,26],
      [510,126,34,24,22],[445,128,30,22,21],[390,130,25,19,20],[336,130,28,21,20],
      [345,-12,18,14,22],[404,-4,16,13,20],[395,88,15,12,18],
    ];
    mountains.forEach(([x, z, sx, sy, sz], index) => this.addMountain(x, z, sx, sy, sz, index % 3 ? rock : darkRock));

    this.buildReservoirTunnel(tunnel, safety);
    for (const [x, z] of [[288,66],[326,108],[426,103],[489,92],[532,18],[505,-82],[420,-108],[338,-103]] as const) {
      this.buildWatchTower(x, z, metal, glass);
    }
  }

  private buildReservoirRidgeRoutes(
    soil: THREE.Material,
    rock: THREE.Material,
    darkRock: THREE.Material,
  ): void {
    const gravel = new THREE.MeshStandardMaterial({ color: '#8a8a71', roughness: 0.99 });

    // Western ridge: a raised overlook with two independent approaches.
    this.addBox(305, 1.35, -83, 32, 2.7, 16, soil, true);
    this.buildTerrainRamp(305, -63, 'z', -1, 16, 7, 2.7, soil);
    this.buildTerrainRamp(329, -83, 'x', -1, 16, 7, 2.7, soil);
    this.addRotatedBox(305, 2.73, -83, 27, 0.06, 4.8, gravel, 0, false, false);
    for (const [x, z, width, height, depth] of [
      [289,-73,5,4,5],[319,-72,4,3.4,5],[289,-93,6,4.5,5],[318,-94,5,3.8,5],
    ] as const) this.addMountain(x, z, width, height, depth, x % 2 ? rock : darkRock);

    // Eastern hidden route sits above the road and is screened by rock outcrops.
    this.addBox(512, 1.1, 70, 22, 2.2, 14, soil, true);
    this.buildTerrainRamp(493, 70, 'x', 1, 16, 6.5, 2.2, soil);
    this.buildTerrainRamp(512, 55, 'z', 1, 16, 6.5, 2.2, soil);
    this.addRotatedBox(512, 2.23, 70, 18, 0.06, 4.4, gravel, -0.08, false, false);
    for (const [x, z, width, height, depth] of [
      [502,79,4.5,3.6,5],[523,79,5,4.2,5],[525,62,4,3.5,4.5],[501,61,4,3.2,4],
    ] as const) this.addMountain(x, z, width, height, depth, z % 2 ? darkRock : rock);
  }

  private buildTerrainRamp(
    x: number,
    z: number,
    axis: 'x' | 'z',
    highDirection: 1 | -1,
    length: number,
    width: number,
    rise: number,
    material: THREE.Material,
  ): void {
    const angle = Math.atan2(rise, length);
    const rotationAngle = axis === 'x' ? highDirection * angle : -highDirection * angle;
    const geometry = axis === 'x'
      ? new THREE.BoxGeometry(length, 0.26, width)
      : new THREE.BoxGeometry(width, 0.26, length);
    const ramp = new THREE.Mesh(geometry, material);
    ramp.position.set(x, rise / 2, z);
    if (axis === 'x') ramp.rotation.z = rotationAngle;
    else ramp.rotation.x = rotationAngle;
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    this.scene.add(ramp);
    this.blockers.push(ramp);
    const rotation = axis === 'x'
      ? { x: 0, y: 0, z: Math.sin(rotationAngle / 2), w: Math.cos(rotationAngle / 2) }
      : { x: Math.sin(rotationAngle / 2), y: 0, z: 0, w: Math.cos(rotationAngle / 2) };
    const body = this.physicsWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, rise / 2, z).setRotation(rotation),
    );
    this.physicsWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(axis === 'x' ? length / 2 : width / 2, 0.13, axis === 'x' ? width / 2 : length / 2),
      body,
    );
  }

  private buildReservoirTunnel(wall: THREE.Material, safety: THREE.Material): void {
    const floorY = -3.8;
    const wallCenterY = -2.36;
    const wallHeight = 2.5;
    this.addBox(360, floorY, 78, 178, 0.35, 8.5, wall, true);
    this.addTunnelWallX(271, 449, 73.75, -1.78, 3.7, [[310, 9], [390, 9]], wall);
    this.addTunnelWallX(271, 449, 82.25, -1.78, 3.7, [[438, 9]], wall);
    this.addBox(360, 0.02, 78, 178, 0.38, 8.8, wall, true);

    // Two southern branches lead to an equipment room and a drainage chamber.
    this.buildUndergroundCorridorZ(310, 62.4, 22.8, 8.5, floorY, wallCenterY, wallHeight, wall);
    this.buildUndergroundRoom(310, 42, 22, 18, floorY, wallCenterY, wallHeight, wall);
    this.buildUndergroundCorridorZ(390, 63, 22, 8.5, floorY, wallCenterY, wallHeight, wall);
    this.buildUndergroundRoom(390, 42, 26, 20, floorY, wallCenterY, wallHeight, wall);
    this.buildUndergroundCorridorX(349, 42, 56, 7.5, floorY, wallCenterY, wallHeight, wall);

    // A northern emergency branch creates a fourth exit instead of a single straight tube.
    this.buildUndergroundCorridorZ(438, 90, 16, 8.5, floorY, wallCenterY, wallHeight, wall);

    const pipeMaterial = new THREE.MeshStandardMaterial({ color: '#849078', roughness: 0.44, metalness: 0.58 });
    const pipeAccent = new THREE.MeshStandardMaterial({ color: '#d0a42e', roughness: 0.5, metalness: 0.42 });
    for (const z of [75.15, 80.85]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 164, 18), pipeMaterial);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(360, -1.05, z);
      pipe.castShadow = true;
      this.scene.add(pipe);
    }
    for (let x = 286; x <= 438; x += 12) {
      for (const z of [75.15, 80.85]) {
        const collar = new THREE.Mesh(new THREE.TorusGeometry(0.57, 0.07, 7, 16), pipeAccent);
        collar.rotation.y = Math.PI / 2;
        collar.position.set(x, -1.05, z);
        this.scene.add(collar);
      }
      const lamp = new THREE.PointLight('#c9ffd0', 1.35, 15, 2);
      lamp.position.set(x, -0.35, 78);
      lamp.visible = false;
      this.scene.add(lamp);
      this.staticPointLights.push(lamp);
      this.addBox(x, -0.22, 78, 1.8, 0.07, 0.22, safety, false, false);
    }

    // Equipment racks stay against the walls so the room and its four doors remain clear.
    const machinery = new THREE.MeshStandardMaterial({ color: '#384842', roughness: 0.48, metalness: 0.62 });
    for (const x of [303, 308, 313, 318]) {
      this.addBox(x, -2.92, 36.5, 2.3, 1.4, 1.25, machinery, true);
      this.addBox(x, -2.08, 36.5, 1.5, 0.12, 0.72, safety, false, false);
    }
    for (const z of [38, 46]) this.addBox(304, -2.92, z, 1.4, 1.4, 2.2, machinery, true);

    // The drainage chamber has shallow water, grated walkways and pumps on the edges.
    const drainWater = new THREE.MeshPhysicalMaterial({
      color: '#245d64', roughness: 0.18, clearcoat: 0.55, transparent: true, opacity: 0.82,
    });
    this.addBox(390, -3.57, 42, 24.8, 0.05, 18.8, drainWater, false, false);
    this.addBox(390, -3.48, 42, 3.2, 0.12, 18, safety, true, false);
    this.addBox(390, -3.48, 42, 24, 0.12, 2.8, safety, true, false);
    for (const x of [381, 399]) {
      const pump = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 1.6, 16), machinery);
      pump.position.set(x, -2.78, 47);
      pump.castShadow = true;
      this.scene.add(pump);
      this.blockers.push(pump);
      this.addStaticCollider(x, -2.78, 47, 2.3, 1.6, 2.3);
    }
    for (const [x, z] of [[310,42],[334,42],[366,42],[390,42],[438,91]] as const) {
      const lamp = new THREE.PointLight('#b9f2ca', 1.2, 13, 2);
      lamp.position.set(x, -1.3, z);
      lamp.visible = false;
      this.scene.add(lamp);
      this.staticPointLights.push(lamp);
    }

    // Shallow ramps work reliably in both directions and cannot present a solid step wall.
    this.buildTunnelRamp(266.5, 78, 1, wall, safety);
    this.buildTunnelRamp(453.5, 78, -1, wall, safety);
    this.buildTunnelRampZ(310, 24, -1, wall, safety);
    this.buildTunnelRampZ(438, 105, 1, wall, safety);
    this.addBox(260.2, -0.08, 82, 5.5, 0.16, 6.5, wall, true);
    this.addBox(459.8, -0.08, 82, 5.5, 0.16, 6.5, wall, true);
    this.buildTunnelPortal(259.8, 78, safety, '地下管道 A');
    this.buildTunnelPortal(460.2, 78, safety, '地下管道 B');
    this.buildTunnelPortalZ(310, 15.8, safety, '设备间出口');
    this.buildTunnelPortalZ(438, 114.2, safety, '排水区出口');
  }

  private addTunnelWallX(
    startX: number,
    endX: number,
    z: number,
    y: number,
    height: number,
    openings: Array<[number, number]>,
    material: THREE.Material,
  ): void {
    let cursor = startX;
    for (const [center, width] of [...openings].sort((a, b) => a[0] - b[0])) {
      const segmentEnd = Math.max(cursor, center - width / 2);
      if (segmentEnd - cursor > 0.1) this.addBox((cursor + segmentEnd) / 2, y, z, segmentEnd - cursor, height, 0.35, material, true);
      cursor = Math.max(cursor, center + width / 2);
    }
    if (endX - cursor > 0.1) this.addBox((cursor + endX) / 2, y, z, endX - cursor, height, 0.35, material, true);
  }

  private buildUndergroundCorridorZ(
    x: number,
    z: number,
    depth: number,
    width: number,
    floorY: number,
    wallY: number,
    wallHeight: number,
    material: THREE.Material,
  ): void {
    this.addBox(x, floorY, z, width, 0.35, depth, material, true);
    this.addBox(x - width / 2, wallY, z, 0.35, wallHeight, depth, material, true);
    this.addBox(x + width / 2, wallY, z, 0.35, wallHeight, depth, material, true);
    this.addBox(x, -1.02, z, width + 0.35, 0.18, depth, material, true);
  }

  private buildUndergroundCorridorX(
    x: number,
    z: number,
    width: number,
    depth: number,
    floorY: number,
    wallY: number,
    wallHeight: number,
    material: THREE.Material,
  ): void {
    this.addBox(x, floorY, z, width, 0.35, depth, material, true);
    this.addBox(x, wallY, z - depth / 2, width, wallHeight, 0.35, material, true);
    this.addBox(x, wallY, z + depth / 2, width, wallHeight, 0.35, material, true);
    this.addBox(x, -1.02, z, width, 0.18, depth + 0.35, material, true);
  }

  private buildUndergroundRoom(
    x: number,
    z: number,
    width: number,
    depth: number,
    floorY: number,
    wallY: number,
    wallHeight: number,
    material: THREE.Material,
  ): void {
    const doorWidth = 4.2;
    const halfWidth = width / 2;
    const halfDepth = depth / 2;
    this.addBox(x, floorY, z, width, 0.35, depth, material, true);
    this.addBox(x, -1.02, z, width, 0.18, depth, material, true);
    for (const wallZ of [z - halfDepth, z + halfDepth]) {
      const segmentWidth = (width - doorWidth) / 2;
      this.addBox(x - (doorWidth + segmentWidth) / 2, wallY, wallZ, segmentWidth, wallHeight, 0.35, material, true);
      this.addBox(x + (doorWidth + segmentWidth) / 2, wallY, wallZ, segmentWidth, wallHeight, 0.35, material, true);
    }
    for (const wallX of [x - halfWidth, x + halfWidth]) {
      const segmentDepth = (depth - doorWidth) / 2;
      this.addBox(wallX, wallY, z - (doorWidth + segmentDepth) / 2, 0.35, wallHeight, segmentDepth, material, true);
      this.addBox(wallX, wallY, z + (doorWidth + segmentDepth) / 2, 0.35, wallHeight, segmentDepth, material, true);
    }
  }

  private buildTunnelRampZ(
    x: number,
    z: number,
    direction: 1 | -1,
    material: THREE.Material,
    rail: THREE.Material,
  ): void {
    const length = 16;
    const drop = 3.55;
    const angle = -direction * Math.atan2(drop, length);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.28, length), material);
    ramp.position.set(x, -drop / 2 - 0.04, z);
    ramp.rotation.x = angle;
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    this.scene.add(ramp);
    this.blockers.push(ramp);
    const rotation = { x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) };
    const body = this.physicsWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, -drop / 2 - 0.04, z).setRotation(rotation),
    );
    this.physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(2.7, 0.14, length / 2), body);
    for (const side of [-1, 1]) {
      const railMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, length), rail);
      railMesh.position.set(x + side * 2.72, -drop / 2 + 0.72, z);
      railMesh.rotation.x = angle;
      this.scene.add(railMesh);
    }
  }

  private buildTunnelPortalZ(x: number, z: number, material: THREE.Material, label: string): void {
    this.addBox(x - 3.1, 1.65, z, 0.38, 3.3, 0.38, material, true);
    this.addBox(x + 3.1, 1.65, z, 0.38, 3.3, 0.38, material, true);
    this.addBox(x, 3.25, z, 6.6, 0.28, 0.38, material, true);
    const sign = this.makeWorldLabel(label, '#f2cf4b');
    sign.position.set(x, 2.72, z);
    sign.scale.set(4.8, 1.2, 1);
    this.scene.add(sign);
  }

  private buildTunnelRamp(
    x: number,
    z: number,
    direction: 1 | -1,
    material: THREE.Material,
    rail: THREE.Material,
  ): void {
    const length = 14;
    const drop = 3.55;
    const angle = -direction * Math.atan2(drop, length);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(length, 0.28, 5.4), material);
    ramp.position.set(x, -drop / 2 - 0.04, z);
    ramp.rotation.z = angle;
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    this.scene.add(ramp);
    this.blockers.push(ramp);

    const rotation = { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) };
    const body = this.physicsWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, -drop / 2 - 0.04, z).setRotation(rotation),
    );
    this.physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(length / 2, 0.14, 2.7), body);

    for (const side of [-1, 1]) {
      const railMesh = new THREE.Mesh(new THREE.BoxGeometry(length, 0.12, 0.12), rail);
      railMesh.position.set(x, -drop / 2 + 0.72, z + side * 2.72);
      railMesh.rotation.z = angle;
      this.scene.add(railMesh);
    }
    for (let offset = -5.5; offset <= 5.5; offset += 1.1) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 5.15), rail);
      stripe.position.set(x + offset, -drop / 2 - direction * offset * (drop / length) + 0.13, z);
      stripe.rotation.z = angle;
      this.scene.add(stripe);
    }
  }

  private buildTunnelPortal(x: number, z: number, material: THREE.Material, label: string): void {
    this.addBox(x, 1.65, z - 3.1, 0.38, 3.3, 0.38, material, true);
    this.addBox(x, 1.65, z + 3.1, 0.38, 3.3, 0.38, material, true);
    this.addBox(x, 3.25, z, 0.38, 0.28, 6.6, material, true);
    const sign = this.makeWorldLabel(label, '#f2cf4b');
    sign.position.set(x, 2.72, z);
    sign.scale.set(4.8, 1.2, 1);
    this.scene.add(sign);
  }

  private makeWorldLabel(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    context.fillStyle = 'rgba(8, 16, 12, 0.9)';
    context.fillRect(4, 4, 504, 120);
    context.strokeStyle = color;
    context.lineWidth = 8;
    context.strokeRect(4, 4, 504, 120);
    context.fillStyle = color;
    context.font = '700 48px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 256, 66);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  }

  private addMountain(
    x: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    material: THREE.Material,
  ): void {
    const mountain = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), material);
    mountain.position.set(x, height * 0.38 - 1.1, z);
    mountain.scale.set(width, height, depth);
    mountain.rotation.set(0.08, (x * 0.017 + z * 0.013) % Math.PI, -0.05);
    mountain.castShadow = true;
    mountain.receiveShadow = true;
    this.scene.add(mountain);
    this.blockers.push(mountain);
    this.addStaticCollider(x, height * 0.3, z, width * 1.45, height * 0.85, depth * 1.45);
  }

  private addRotatedBox(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    material: THREE.Material,
    rotationY: number,
    collide: boolean,
    castShadow = true,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(this.sharedBoxGeometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    mesh.rotation.y = rotationY;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    if (collide) {
      this.blockers.push(mesh);
      const body = this.physicsWorld.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(rotationY / 2), z: 0, w: Math.cos(rotationY / 2) }),
      );
      this.physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2), body);
    }
    return mesh;
  }

  private buildExtendedOperations(concrete: THREE.Material, roof: THREE.Material, metal: THREE.Material): void {
    const glass = new THREE.MeshStandardMaterial({ color: '#87aaa2', emissive: '#163b37', emissiveIntensity: 0.8, roughness: 0.2 });
    const radarStart = this.scene.children.length;
    const ground = new THREE.MeshStandardMaterial({ color: '#515a4e', roughness: 0.94 });
    this.addBox(-76, -0.5, 0, 62, 1, 150, ground, true);
    this.buildBlockBuilding(-72, -20, 24, 22, 8, concrete, roof, glass);
    this.buildBlockBuilding(-91, 21, 17, 15, 5.5, concrete, roof, glass);
    this.buildBlockBuilding(-55, 31, 18, 13, 6, metal, roof, glass);
    const radar = new THREE.Mesh(new THREE.SphereGeometry(7, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), metal);
    radar.position.set(-72, 10.5, -20);
    radar.rotation.x = -0.45;
    radar.castShadow = true;
    this.scene.add(radar);
    for (const [x, z] of [[-99,-48],[-55,-48],[-101,48],[-50,5]] as const) this.buildWatchTower(x, z, metal, glass);
    this.assignSceneChildrenToLayer(radarStart, MAP_RENDER_LAYERS.radar);

    const refineryStart = this.scene.children.length;
    const refineryGround = new THREE.MeshStandardMaterial({ color: '#5b5447', roughness: 0.94 });
    this.addBox(78, -0.5, 0, 64, 1, 150, refineryGround, true);
    this.buildBlockBuilding(72, -12, 25, 20, 8, concrete, roof, glass);
    this.buildBlockBuilding(99, 25, 17, 16, 6, metal, roof, glass);
    this.buildBlockBuilding(55, 31, 18, 14, 5.5, concrete, roof, glass);
    const tankMaterial = new THREE.MeshStandardMaterial({ color: '#a7ad98', roughness: 0.5, metalness: 0.55 });
    for (const [x, z] of [[58,-22],[65,-36],[87,-30],[101,-12],[55,8],[84,12]] as const) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 6.5, 20), tankMaterial);
      tank.position.set(x, 3.25, z);
      tank.castShadow = true;
      this.scene.add(tank);
      this.addStaticCollider(x, 3.25, z, 6.4, 6.5, 6.4);
      this.blockers.push(tank);
    }
    for (const [x, z] of [[104,-49],[51,-48],[104,48],[49,5]] as const) this.buildWatchTower(x, z, metal, glass);
    this.assignSceneChildrenToLayer(refineryStart, MAP_RENDER_LAYERS.refinery);
  }

  private buildAdministrationDistrict(concrete: THREE.Material, roof: THREE.Material, metal: THREE.Material): void {
    const ground = new THREE.MeshStandardMaterial({ color: '#555b56', roughness: 0.92 });
    const paving = new THREE.MeshStandardMaterial({ color: '#454b49', roughness: 0.88, metalness: 0.04 });
    const marble = new THREE.MeshStandardMaterial({ color: '#c5c4ba', roughness: 0.55, metalness: 0.04 });
    const interior = new THREE.MeshStandardMaterial({ color: '#6f7874', roughness: 0.8 });
    const glass = new THREE.MeshStandardMaterial({ color: '#80b9b4', emissive: '#163b39', emissiveIntensity: 1.1, roughness: 0.16, metalness: 0.12 });
    const warning = new THREE.MeshStandardMaterial({ color: '#8f2f28', emissive: '#3d0906', emissiveIntensity: 0.7, roughness: 0.6 });

    this.addBox(165, -0.5, 5, 130, 1, 326, ground, true);
    this.addBox(165, 0.015, 108, 18, 0.04, 112, paving, false, false);
    this.addBox(115, 0.015, 13, 14, 0.04, 282, paving, false, false);
    this.addBox(215, 0.015, 13, 14, 0.04, 282, paving, false, false);
    this.addBox(165, 0.016, 119, 112, 0.04, 12, paving, false, false);
    this.addBox(165, 0.016, -112, 112, 0.04, 12, paving, false, false);
    this.addBox(165, 0.02, 37, 30, 0.06, 44, marble, false, false);

    // Main building forms a U shape with a large open courtyard and walkable entrances.
    this.buildAdministrationWing(132, -10, 18, 92, 12, concrete, roof, glass, 'east');
    this.buildAdministrationWing(198, -10, 18, 92, 12, concrete, roof, glass, 'west');
    this.buildAdministrationWing(165, -49, 48, 18, 15, concrete, roof, glass, 'south');

    // Two accessible annexes turn the enlarged outer district into usable routes,
    // rather than decorative solid blocks. Their doors face the main courtyard.
    this.buildAdministrationAnnex(111, -73, 22, 30, 6.4, concrete, roof, glass, interior, 'east');
    this.buildAdministrationAnnex(219, -73, 22, 34, 6.4, concrete, roof, glass, interior, 'west');

    // The outer district contains real interiors instead of sealed decorative blocks.
    this.buildBlockBuilding(123, 139, 24, 26, 7.2, concrete, roof, glass);
    this.buildBlockBuilding(207, 134, 24, 30, 7.2, concrete, roof, glass);
    this.buildBlockBuilding(123, -129, 26, 28, 7, concrete, roof, glass);
    this.buildBlockBuilding(207, -127, 24, 28, 7.4, concrete, roof, glass);
    this.buildBlockBuilding(165, -141, 34, 18, 5.8, metal, roof, glass);
    this.buildAdministrationLandscape();

    // Interior corridors, office partitions and a central boss chamber.
    this.buildAdministrationUpperFloor(132, 136, interior);
    this.buildAdministrationUpperFloor(198, 194, interior);
    ADMIN_STAIRS.forEach(({ x, z }, index) => {
      this.buildAdministrationStairs(x, z, index === 0 ? 1 : -1, interior, metal);
    });
    this.buildAdministrationSecretRoom(interior, metal);
    for (const [x, z] of [[136, 23.4], [194, 10.6]] as const) {
      const floorSign = this.makeWorldLabel('2F 行政办公区', '#f0c958');
      floorSign.position.set(x, 7.45, z);
      floorSign.scale.set(4.8, 1.2, 1);
      this.scene.add(floorSign);
    }
    for (const z of [22, 4, -14, -31]) {
      // This entire north bay must remain open: both the old platform and its
      // glass partition crossed the stair runs and blocked players halfway up.
      if (z === 22) continue;
      this.addBox(142, 2.2, z, 14, 0.25, 8, interior, true);
      this.addBox(188, 2.2, z, 14, 0.25, 8, interior, true);
      this.addBox(142, 1.1, z - 3.8, 14, 2.2, 0.18, glass, true, false);
      this.addBox(188, 1.1, z - 3.8, 14, 2.2, 0.18, glass, true, false);
    }
    this.addBox(165, 0.05, -25, 42, 0.1, 30, marble, false);
    this.addBox(145, 3.5, -42, 0.5, 7, 14, metal, true);
    this.addBox(185, 3.5, -42, 0.5, 7, 14, metal, true);
    this.addBox(165, 6.9, -42, 40, 0.35, 14, roof, false);
    this.addBox(165, 0.08, -27, 12, 0.08, 12, warning, false, false);

    // Reception, security gates and recognizable administrative details.
    this.addBox(165, 1.15, 35, 14, 2.3, 2.2, interior, true);
    for (const x of [154, 160, 170, 176]) this.addBox(x, 1.1, 27, 0.3, 2.2, 3.2, metal, true);
    for (const [x, z] of [[153,12],[177,12],[153,-8],[177,-8],[154,-34],[176,-34]] as const) {
      this.addBox(x, 1.05, z, 3.8, 2.1, 1.5, interior, true);
    }

    const lampMaterial = new THREE.MeshBasicMaterial({ color: '#dff6df' });
    for (const z of [32, 16, 0, -16, -34]) {
      const lamp = this.addBox(165, 4.9, z, 6, 0.1, 0.28, lampMaterial, false, false);
      lamp.renderOrder = 2;
    }

    for (const [x, z] of [[108,76],[222,76],[136,-86],[194,-86],[108,155],[222,155],[108,-146],[222,-146]] as const) {
      this.buildWatchTower(x, z, metal, glass);
    }
    // Low perimeter barriers mark the expanded boundary while keeping four broad entrances open.
    this.addBox(132, 0.7, 107, 56, 1.4, 0.5, metal, true);
    this.addBox(198, 0.7, 107, 44, 1.4, 0.5, metal, true);
    this.addBox(100.5, 0.7, 7, 0.5, 1.4, 152, metal, true);
    this.addBox(229.5, 0.7, 7, 0.5, 1.4, 152, metal, true);
    // Outer fence leaves a broad deployment gate and two side escape routes.
    this.addBox(126, 0.7, 167.5, 52, 1.4, 0.5, metal, true);
    this.addBox(204, 0.7, 167.5, 52, 1.4, 0.5, metal, true);
    this.addBox(126, 0.7, -157.5, 52, 1.4, 0.5, metal, true);
    this.addBox(204, 0.7, -157.5, 52, 1.4, 0.5, metal, true);
    for (const [x, z, depth] of [
      [100.5, 139, 38], [100.5, 58, 92], [100.5, -58, 92], [100.5, -139, 38],
      [229.5, 139, 38], [229.5, 58, 92], [229.5, -58, 92], [229.5, -139, 38],
    ] as const) this.addBox(x, 0.7, z, 0.5, 1.4, depth, metal, true);
    this.addBox(165, 6.5, -59, 24, 2.2, 0.45, warning, false, false);
  }

  private buildAdministrationLandscape(): void {
    const grassPatch = new THREE.MeshStandardMaterial({ color: '#536c4a', roughness: 1 });
    const soil = new THREE.MeshStandardMaterial({ color: '#62654f', roughness: 1 });
    const rock = new THREE.MeshStandardMaterial({ color: '#657066', roughness: 0.98, flatShading: true });
    const darkRock = new THREE.MeshStandardMaterial({ color: '#444d47', roughness: 1, flatShading: true });

    for (const [x, z, width, depth] of [
      [127, 116, 42, 17], [204, 116, 38, 17], [127, -106, 42, 18], [204, -106, 38, 18],
      [107, 18, 11, 174], [223, 18, 11, 174],
    ] as const) this.addBox(x, 0.025, z, width, 0.045, depth, grassPatch, false, false);

    // Two low plateaus introduce genuine height changes while preserving wide road approaches.
    this.addBox(112, 0.55, 117, 20, 1.1, 18, soil, true);
    this.buildTerrainRamp(112, 101, 'z', 1, 14, 7.5, 1.1, soil);
    this.addBox(214, 0.65, -103, 18, 1.3, 14, soil, true);
    this.buildTerrainRamp(214, -89, 'z', -1, 13, 7, 1.3, soil);

    const grassZones = [
      [102, 151, 109, 164, 210], [179, 228, 109, 164, 210],
      [102, 151, -154, -101, 190], [179, 228, -154, -101, 190],
      [102, 122, -82, 98, 130], [208, 228, -82, 98, 130],
    ] as const;
    const exclusions = [
      [109, 137, 124, 154], [193, 221, 117, 152], [108, 138, -145, -113],
      [193, 221, -143, -111], [146, 184, -152, -130], [102, 122, 108, 128],
      [204, 224, -112, -94],
    ] as const;
    const isExcluded = (x: number, z: number): boolean => exclusions.some(([minX, maxX, minZ, maxZ]) => (
      x >= minX && x <= maxX && z >= minZ && z <= maxZ
    ));
    const random = new SeededRandom(731_947);
    const grassPlacements: Array<[number, number, number, number]> = [];
    for (const [minX, maxX, minZ, maxZ, target] of grassZones) {
      const startCount = grassPlacements.length;
      let attempts = 0;
      while (grassPlacements.length - startCount < target && attempts < target * 5) {
        attempts += 1;
        const x = minX + random.next() * (maxX - minX);
        const z = minZ + random.next() * (maxZ - minZ);
        if (isExcluded(x, z)) continue;
        grassPlacements.push([x, z, random.next() * Math.PI * 2, 0.72 + random.next() * 0.7]);
      }
    }
    const grassGeometry = new THREE.ConeGeometry(0.11, 0.48, 3);
    const grassMaterial = new THREE.MeshStandardMaterial({ color: '#607b51', roughness: 1, side: THREE.DoubleSide });
    const grass = new THREE.InstancedMesh(grassGeometry, grassMaterial, grassPlacements.length);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    grassPlacements.forEach(([x, z, rotation, scale], index) => {
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
      matrix.compose(new THREE.Vector3(x, 0.24 * scale, z), quaternion, new THREE.Vector3(scale, scale, scale));
      grass.setMatrixAt(index, matrix);
    });
    grass.instanceMatrix.needsUpdate = true;
    grass.castShadow = false;
    grass.receiveShadow = true;
    this.scene.add(grass);

    const bushGeometry = new THREE.DodecahedronGeometry(0.7, 0);
    const bushMaterial = new THREE.MeshStandardMaterial({ color: '#3f5c43', roughness: 1, flatShading: true });
    const bushes = new THREE.InstancedMesh(bushGeometry, bushMaterial, 112);
    for (let index = 0; index < 112; index += 1) {
      const north = index < 56;
      let x = 104 + random.next() * 122;
      let z = north ? 110 + random.next() * 51 : -151 + random.next() * 48;
      for (let retry = 0; retry < 8 && isExcluded(x, z); retry += 1) {
        x = 104 + random.next() * 122;
        z = north ? 110 + random.next() * 51 : -151 + random.next() * 48;
      }
      const sx = 0.75 + random.next() * 0.75;
      const sy = 0.55 + random.next() * 0.55;
      const sz = 0.8 + random.next() * 0.8;
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), random.next() * Math.PI * 2);
      matrix.compose(new THREE.Vector3(x, 0.48 * sy, z), quaternion, new THREE.Vector3(sx, sy, sz));
      bushes.setMatrixAt(index, matrix);
    }
    bushes.instanceMatrix.needsUpdate = true;
    bushes.castShadow = false;
    bushes.receiveShadow = true;
    this.scene.add(bushes);

    for (const [x, z, width, height, depth, material] of [
      [104, 121, 3.2, 2.1, 2.6, darkRock], [119, 106, 4.4, 2.5, 3.1, rock],
      [221, -94, 3.8, 2.4, 3, darkRock], [207, -109, 4.8, 2.8, 3.5, rock],
      [106, -116, 3.5, 2.2, 2.8, rock], [224, 151, 3.2, 2, 2.7, darkRock],
    ] as const) this.addAdministrationRock(x, z, width, height, depth, material);
  }

  private addAdministrationRock(
    x: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    material: THREE.Material,
  ): void {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), material);
    mesh.position.set(x, height * 0.4, z);
    mesh.scale.set(width / 2, height / 2, depth / 2);
    mesh.rotation.set(0.12, (x + z) * 0.17, -0.08);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.surface = 'concrete';
    this.scene.add(mesh);
    this.blockers.push(mesh);
    this.addStaticCollider(x, height * 0.32, z, width * 0.68, height * 0.62, depth * 0.68);
  }

  private buildAdministrationAnnex(
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    body: THREE.Material,
    roof: THREE.Material,
    windows: THREE.Material,
    interior: THREE.Material,
    entranceSide: 'east' | 'west',
  ): void {
    const halfWidth = width / 2;
    const halfDepth = depth / 2;
    const doorWidth = 4.6;
    const doorHeight = 3.25;
    const entranceX = entranceSide === 'east' ? x + halfWidth : x - halfWidth;
    const backX = entranceSide === 'east' ? x - halfWidth : x + halfWidth;
    const frontSegmentDepth = (depth - doorWidth) / 2;

    this.addBox(x, 0.04, z, width, 0.08, depth, interior, false);
    this.addBox(backX, height / 2, z, 0.5, height, depth, body, true);
    this.addBox(entranceX, height / 2, z - (doorWidth + frontSegmentDepth) / 2, 0.5, height, frontSegmentDepth, body, true);
    this.addBox(entranceX, height / 2, z + (doorWidth + frontSegmentDepth) / 2, 0.5, height, frontSegmentDepth, body, true);
    this.addBox(entranceX, doorHeight + (height - doorHeight) / 2, z, 0.5, height - doorHeight, doorWidth, body, true);
    this.addBox(x, height / 2, z - halfDepth, width, height, 0.5, body, true);
    this.addBox(x, height / 2, z + halfDepth, width, height, 0.5, body, true);
    this.addBox(x, height + 0.16, z, width + 0.5, 0.32, depth + 0.5, roof, false);

    const windowX = entranceX + (entranceSide === 'east' ? 0.27 : -0.27);
    for (const offsetZ of [-9, 9]) {
      this.addBox(windowX, 2.25, z + offsetZ, 0.05, 1.6, 4.2, windows, false, false);
    }
    // Short partitions form offices but leave a wide central passage from the door.
    this.addBox(x, 1.5, z - 6.5, width - 7, 3, 0.24, interior, true);
    this.addBox(x, 1.5, z + 6.5, width - 7, 3, 0.24, interior, true);
    this.addBox(backX + (entranceSide === 'east' ? 3.5 : -3.5), 0.9, z, 2.8, 1.8, 1.2, interior, true);
  }

  private buildAdministrationUpperFloor(
    wingX: number,
    stairX: number,
    material: THREE.Material,
  ): void {
    const wingMinX = wingX - 8.4;
    const wingMaxX = wingX + 8.4;
    const openingHalfWidth = 3.2;
    const openingMinX = stairX - openingHalfWidth;
    const openingMaxX = stairX + openingHalfWidth;
    const wingMinZ = -55;
    const wingMaxZ = 35;
    const openingMinZ = 11.6;
    const openingMaxZ = 22.4;
    const floorY = ADMIN_UPPER_FLOOR_Y;

    // Four slabs leave a generous 6.4 x 10.8 m stairwell opening. The
    // opening is wider and longer than the stair mesh so the player capsule can
    // clear the underside of the floor before reaching the landing.
    this.addBox(
      (wingMinX + openingMinX) / 2,
      floorY,
      (wingMinZ + wingMaxZ) / 2,
      openingMinX - wingMinX,
      0.28,
      wingMaxZ - wingMinZ,
      material,
      true,
    );
    this.addBox(
      (openingMaxX + wingMaxX) / 2,
      floorY,
      (wingMinZ + wingMaxZ) / 2,
      wingMaxX - openingMaxX,
      0.28,
      wingMaxZ - wingMinZ,
      material,
      true,
    );
    this.addBox(
      stairX,
      floorY,
      (wingMinZ + openingMinZ) / 2,
      openingMaxX - openingMinX,
      0.28,
      openingMinZ - wingMinZ,
      material,
      true,
    );
    this.addBox(
      stairX,
      floorY,
      (openingMaxZ + wingMaxZ) / 2,
      openingMaxX - openingMinX,
      0.28,
      wingMaxZ - openingMaxZ,
      material,
      true,
    );
  }

  private buildAdministrationStairs(
    x: number,
    z: number,
    direction: 1 | -1,
    stepMaterial: THREE.Material,
    railMaterial: THREE.Material,
  ): void {
    const stepCount = 14;
    const horizontalRun = 8.4;
    const stepDepth = horizontalRun / stepCount + 0.04;
    for (let index = 0; index < stepCount; index += 1) {
      const height = (index + 1) * (ADMIN_UPPER_FLOOR_Y / stepCount);
      const stepZ = z + direction * (-horizontalRun / 2 + (index + 0.5) * (horizontalRun / stepCount));
      // The visible stair blocks do not collide. A continuous ramp below makes
      // trackpad/keyboard movement smooth and removes seams that used to trap the player.
      this.addBox(x, height / 2, stepZ, 3.6, height, stepDepth, stepMaterial, false);
    }

    const angle = -direction * Math.atan2(ADMIN_UPPER_FLOOR_Y, horizontalRun);
    const rampLength = Math.hypot(horizontalRun, ADMIN_UPPER_FLOOR_Y);
    const rotation = { x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) };
    const body = this.physicsWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, ADMIN_UPPER_FLOOR_Y / 2 - 0.05, z).setRotation(rotation),
    );
    this.physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(1.8, 0.12, rampLength / 2), body);

    // Bridge the final step to the second-floor slab, so neither staircase ends
    // at a gap. The landing overlaps the floor slightly but leaves the shaft open.
    this.addBox(
      x,
      ADMIN_UPPER_FLOOR_Y,
      z + direction * (horizontalRun / 2 + 0.75),
      3.8,
      0.28,
      1.5,
      stepMaterial,
      true,
    );
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(this.sharedBoxGeometry, railMaterial);
      rail.position.set(x + side * 1.86, ADMIN_UPPER_FLOOR_Y / 2 + 0.82, z);
      rail.scale.set(0.12, 0.14, rampLength);
      rail.rotation.x = angle;
      rail.castShadow = true;
      this.scene.add(rail);
    }
  }

  private buildAdministrationSecretRoom(
    wallMaterial: THREE.Material,
    metalMaterial: THREE.Material,
  ): void {
    const floorY = ADMIN_UPPER_FLOOR_Y;
    const wallHeight = 4.9;
    const wallCenterY = floorY + wallHeight / 2;
    const roomMinX = 124.3;
    const roomMaxX = 139.7;
    const doorWidth = 3.6;
    const doorHeight = 3.15;
    const sideWidth = (roomMaxX - roomMinX - doorWidth) / 2;

    this.addBox(roomMinX, wallCenterY, -44, 0.32, wallHeight, 20, wallMaterial, true);
    this.addBox(roomMaxX, wallCenterY, -44, 0.32, wallHeight, 20, wallMaterial, true);
    this.addBox((roomMinX + roomMaxX) / 2, wallCenterY, -53.8, roomMaxX - roomMinX, wallHeight, 0.32, wallMaterial, true);
    this.addBox(
      roomMinX + sideWidth / 2,
      wallCenterY,
      ADMIN_SECRET_ROOM.doorZ,
      sideWidth,
      wallHeight,
      0.32,
      wallMaterial,
      true,
    );
    this.addBox(
      roomMaxX - sideWidth / 2,
      wallCenterY,
      ADMIN_SECRET_ROOM.doorZ,
      sideWidth,
      wallHeight,
      0.32,
      wallMaterial,
      true,
    );
    this.addBox(
      ADMIN_SECRET_ROOM.x,
      floorY + doorHeight + (wallHeight - doorHeight) / 2,
      ADMIN_SECRET_ROOM.doorZ,
      doorWidth,
      wallHeight - doorHeight,
      0.32,
      wallMaterial,
      true,
    );

    const doorMaterial = new THREE.MeshStandardMaterial({
      color: '#35443e',
      emissive: '#35100d',
      emissiveIntensity: 0.45,
      roughness: 0.44,
      metalness: 0.72,
    });
    this.administrationSecretDoor = new THREE.Mesh(this.sharedBoxGeometry, doorMaterial);
    this.administrationSecretDoor.position.set(
      ADMIN_SECRET_DOOR_CLOSED_X,
      floorY + doorHeight / 2,
      ADMIN_SECRET_ROOM.doorZ,
    );
    this.administrationSecretDoor.scale.set(doorWidth - 0.18, doorHeight, 0.24);
    this.administrationSecretDoor.castShadow = true;
    this.administrationSecretDoor.receiveShadow = true;
    this.scene.add(this.administrationSecretDoor);
    this.blockers.push(this.administrationSecretDoor);
    this.administrationSecretDoorCollider = this.addStaticCollider(
      ADMIN_SECRET_ROOM.x,
      floorY + doorHeight / 2,
      ADMIN_SECRET_ROOM.doorZ,
      doorWidth - 0.18,
      doorHeight,
      0.24,
    );

    this.administrationSecretReader = this.makeMissionTerminal();
    this.administrationSecretReader.scale.setScalar(0.58);
    this.administrationSecretReader.position.set(134.75, floorY + 0.12, ADMIN_SECRET_ROOM.doorZ + 0.28);
    this.administrationSecretReader.rotation.y = Math.PI;
    this.scene.add(this.administrationSecretReader);
    this.setAdministrationSecretReaderActive(false);

    const roomSign = this.makeWorldLabel('2F 秘密档案室', '#f0c958');
    roomSign.position.set(ADMIN_SECRET_ROOM.x, floorY + 4.2, ADMIN_SECRET_ROOM.doorZ + 0.22);
    roomSign.scale.set(4.4, 1.08, 1);
    this.scene.add(roomSign);

    for (const x of [126.5, 137.5]) {
      this.addBox(x, floorY + 0.75, -49.5, 2.4, 1.5, 0.8, metalMaterial, true);
    }
  }

  private setAdministrationSecretReaderActive(active: boolean): void {
    this.setTerminalActive(this.administrationSecretReader, active);
  }

  private updateAdministrationSecretDoor(delta: number): void {
    this.administrationSecretGate = advanceShortcutGate(this.administrationSecretGate, delta, 1.15);
    if (!this.administrationSecretGate.unlocked) return;
    const eased = 1 - Math.pow(1 - this.administrationSecretGate.openProgress, 3);
    this.administrationSecretDoor.position.x = THREE.MathUtils.lerp(
      ADMIN_SECRET_DOOR_CLOSED_X,
      ADMIN_SECRET_DOOR_OPEN_X,
      eased,
    );
    this.administrationSecretDoorCollider?.setEnabled(this.administrationSecretGate.colliderEnabled);
  }

  private resetAdministrationSecretRoom(): void {
    this.administrationSecretUnlocked = false;
    this.administrationSecretGate = createShortcutGate();
    this.administrationSecretDoor.position.x = ADMIN_SECRET_DOOR_CLOSED_X;
    const active = this.activeOperation.id === 'administration';
    this.administrationSecretDoor.visible = active;
    this.administrationSecretReader.visible = active;
    this.administrationSecretDoorCollider?.setEnabled(active && this.administrationSecretGate.colliderEnabled);
    this.setAdministrationSecretReaderActive(false);
  }

  private buildAdministrationWing(
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    body: THREE.Material,
    roof: THREE.Material,
    windows: THREE.Material,
    entranceSide: 'east' | 'west' | 'south',
  ): void {
    this.addBox(x, 0.04, z, width, 0.08, depth, body, false);
    const halfWidth = width / 2;
    const halfDepth = depth / 2;
    const doorHeight = 3;
    const addDoorLintel = (
      wallX: number,
      wallZ: number,
      lintelWidth: number,
      lintelDepth: number,
      openingHeight = doorHeight,
    ): void => {
      const lintelHeight = height - openingHeight;
      this.addBox(
        wallX,
        openingHeight + lintelHeight / 2,
        wallZ,
        lintelWidth,
        lintelHeight,
        lintelDepth,
        body,
        true,
      );
    };
    const addSideWall = (wallX: number, hasEntrances: boolean): void => {
      if (!hasEntrances) {
        this.addBox(wallX, height / 2, z, 0.6, height, depth, body, true);
        return;
      }
      const doorCenters = [z - 28, z, z + 28];
      const doorHalfDepth = 2;
      let segmentStart = z - halfDepth;
      for (const doorZ of doorCenters) {
        const segmentEnd = doorZ - doorHalfDepth;
        const segmentDepth = segmentEnd - segmentStart;
        this.addBox(wallX, height / 2, segmentStart + segmentDepth / 2, 0.6, height, segmentDepth, body, true);
        const opensToSecondFloor = Math.abs(doorZ - (z + 28)) < 0.01;
        addDoorLintel(wallX, doorZ, 0.6, doorHalfDepth * 2, opensToSecondFloor ? 7.7 : doorHeight);
        segmentStart = doorZ + doorHalfDepth;
      }
      const segmentDepth = z + halfDepth - segmentStart;
      this.addBox(wallX, height / 2, segmentStart + segmentDepth / 2, 0.6, height, segmentDepth, body, true);
    };
    addSideWall(x - halfWidth, entranceSide === 'west');
    addSideWall(x + halfWidth, entranceSide === 'east');

    if (entranceSide === 'south') {
      const entranceWidth = 6;
      const wallSegmentWidth = (width - entranceWidth) / 2;
      this.addBox(x - (entranceWidth + wallSegmentWidth) / 2, height / 2, z + halfDepth, wallSegmentWidth, height, 0.6, body, true);
      this.addBox(x + (entranceWidth + wallSegmentWidth) / 2, height / 2, z + halfDepth, wallSegmentWidth, height, 0.6, body, true);
      addDoorLintel(x, z + halfDepth, entranceWidth, 0.6);
      this.addBox(x, height / 2, z - halfDepth, width, height, 0.6, body, true);
    } else {
      this.addBox(x, height / 2, z - halfDepth, width, height, 0.6, body, true);
      this.addBox(x, height / 2, z + halfDepth, width, height, 0.6, body, true);
    }
    this.addBox(x, height + 0.2, z, width + 0.5, 0.4, depth + 0.5, roof, false);

    for (let floor = 0; floor < 3; floor += 1) {
      const y = 2.4 + floor * 3.4;
      for (let offset = -halfDepth + 7; offset < halfDepth - 3; offset += 8) {
        const sideX = entranceSide === 'east' ? x + halfWidth + 0.02 : x - halfWidth - 0.02;
        const windowZ = z + offset;
        const overlapsDoor = entranceSide !== 'south' && [z - 28, z, z + 28].some((doorZ) => Math.abs(windowZ - doorZ) < 4);
        if (overlapsDoor) continue;
        this.addBox(sideX, y, windowZ, 0.06, 1.35, 3.2, windows, false, false);
      }
    }
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
    const x = 43;
    const z = 4;
    const width = 6.2;
    const depth = 4.8;
    const height = 2.35;
    const wall = 0.3;
    const door = 2.35;
    const doorHeight = 2.08;
    const sideWidth = (width - door) / 2;

    this.addBox(x, 0.035, z, width, 0.07, depth, concrete, false);
    for (const wallZ of [z - depth / 2, z + depth / 2]) {
      this.addBox(x - (door + sideWidth) / 2, height / 2, wallZ, sideWidth, height, wall, concrete, true);
      this.addBox(x + (door + sideWidth) / 2, height / 2, wallZ, sideWidth, height, wall, concrete, true);
      this.addBox(x, doorHeight + (height - doorHeight) / 2, wallZ, door, height - doorHeight, wall, concrete, true);
    }
    this.addBox(x - width / 2, height / 2, z, wall, height, depth, concrete, true);
    this.addBox(x + width / 2, height / 2, z, wall, height, depth, concrete, true);
    this.addBox(x, 2.55, z, 6.6, 0.25, 5.2, metal, false);

    const glass = new THREE.MeshStandardMaterial({
      color: '#8bb2ad', emissive: '#1d3836', emissiveIntensity: 0.55, roughness: 0.2, metalness: 0.1,
    });
    this.addBox(x - width / 2 - 0.01, 1.45, z, 0.04, 0.82, 2.25, glass, false, false);
    this.addBox(x + width / 2 + 0.01, 1.45, z, 0.04, 0.82, 2.25, glass, false, false);

    // The two barriers visibly funnel the road while preserving a wide central lane.
    this.addBox(38.5, 0.5, 0, 5, 1, 0.5, concrete, true);
    this.addBox(48.5, 0.5, 0, 5, 1, 0.5, concrete, true);
  }

  private buildCrane(metal: THREE.Material): void {
    this.addBox(-47, 7, -32, 1.2, 14, 1.2, metal, true);
    this.addBox(-47, 13.5, -20, 1, 1, 24, metal, false);
    this.addBox(-47, 7, -9, 1.2, 14, 1.2, metal, true);
    this.addBox(-47, 10, -20, 0.4, 0.4, 23, metal, false);
  }

  private buildHarborDetails(metal: THREE.Material): void {
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

  private addDestructibleDetails(): void {
    const glass = new THREE.MeshPhysicalMaterial({
      color: '#bde9e6', transparent: true, opacity: 0.34, roughness: 0.08,
      metalness: 0, transmission: 0.42, thickness: 0.06, side: THREE.DoubleSide,
    });
    const metal = new THREE.MeshStandardMaterial({ color: '#6e745f', roughness: 0.52, metalness: 0.5 });
    const prop = new THREE.MeshStandardMaterial({ color: '#8b7651', roughness: 0.86, metalness: 0.08 });
    const lamp = new THREE.MeshStandardMaterial({ color: '#dbe3cf', emissive: '#d9ffae', emissiveIntensity: 2.2, roughness: 0.28 });

    const panels: Array<[MapId, number, number, number, number, number]> = [
      ['harbor', 40.1, 1.45, 4, 0.08, 2.1],
      ['radar', -82, 1.45, -18, 4.8, 2.2],
      ['refinery', 72, 1.45, 11, 5.2, 2.2],
      ['administration', 154, 1.35, 23.2, 5.6, 2.4],
      ['administration', 176, 1.35, 23.2, 5.6, 2.4],
      ['reservoir', 448, 1.5, -69, 6.2, 2.5],
    ];
    for (const [mapId, x, y, z, width, height] of panels) {
      this.addDestructibleBox(mapId, 'glass', x, y, z, width, height, 0.08, glass, 1);
    }

    const barrels: Array<[MapId, number, number]> = [
      ['harbor', -40, 32], ['harbor', 12, 0.8], ['harbor', 35, -9],
      ['radar', -91, 17], ['radar', -61, -22],
      ['refinery', 64, 24], ['refinery', 94, -18], ['refinery', 106, 13],
      ['administration', 133, 31], ['administration', 196, -30], ['administration', 172, 55],
      ['reservoir', 304, 47], ['reservoir', 421, -71], ['reservoir', 494, 62], ['reservoir', 529, -36],
    ];
    for (const [mapId, x, z] of barrels) this.addDestructibleBarrel(mapId, x, z, metal);

    const props: Array<[MapId, number, number, number, number, number]> = [
      ['harbor', -7, 0.45, 19, 1.1, 0.9], ['harbor', 29, 0.55, 13, 1.3, 1.1],
      ['radar', -102, 0.5, -4, 1.2, 1], ['radar', -55, 0.45, 28, 1, 0.9],
      ['refinery', 58, 0.5, -31, 1.2, 1], ['refinery', 103, 0.45, 31, 1, 0.9],
      ['administration', 148, 0.45, -20, 1.1, 0.9], ['administration', 183, 0.5, 34, 1.2, 1],
      ['reservoir', 330, 0.5, 83, 1.2, 1], ['reservoir', 467, 0.45, -52, 1, 0.9],
    ];
    for (const [mapId, x, y, z, width, height] of props) {
      this.addDestructibleBox(mapId, 'prop', x, y, z, width, height, 0.85, prop, 34);
    }

    const lights: Array<[MapId, number, number, number]> = [
      ['harbor', -18, 3.2, -2], ['radar', -76, 3.1, -23], ['refinery', 79, 3.1, -10],
      ['administration', 165, 3.4, 8], ['administration', 165, 3.4, -31],
      ['reservoir', 390, -0.9, 58], ['reservoir', 451, 3.1, -68],
    ];
    for (const [mapId, x, y, z] of lights) {
      const fixture = this.addDestructibleBox(mapId, 'light', x, y, z, 0.5, 0.16, 0.5, lamp, 10);
      const lightSource = new THREE.PointLight('#d9ffb2', 4.5, 15, 2);
      lightSource.position.copy(fixture.mesh.position).add(new THREE.Vector3(0, -0.15, 0));
      lightSource.userData.mapId = mapId;
      lightSource.layers.enable(MAP_RENDER_LAYERS[mapId]);
      this.scene.add(lightSource);
      this.staticPointLights.push(lightSource);
      fixture.linkedLight = lightSource;
    }
  }

  private addDestructibleBox(
    operationId: MapId,
    kind: DestructibleRuntime['kind'],
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    material: THREE.Material,
    health: number,
  ): DestructibleRuntime {
    const mesh = new THREE.Mesh(this.sharedBoxGeometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    mesh.castShadow = kind !== 'glass' && kind !== 'light';
    mesh.receiveShadow = true;
    mesh.layers.set(MAP_RENDER_LAYERS[operationId]);
    const collider = this.addStaticCollider(x, y, z, width, height, depth);
    const runtime: DestructibleRuntime = { mesh, collider, kind, operationId, health, maxHealth: health, destroyed: false };
    mesh.userData.destructible = runtime;
    mesh.userData.surface = kind === 'prop' ? 'wood' : 'metal';
    this.scene.add(mesh);
    this.blockers.push(mesh);
    this.destructibles.push(runtime);
    return runtime;
  }

  private addDestructibleBarrel(operationId: MapId, x: number, z: number, material: THREE.Material): void {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.95, 14), material);
    mesh.position.set(x, 0.48, z);
    mesh.castShadow = true;
    mesh.layers.set(MAP_RENDER_LAYERS[operationId]);
    const collider = this.addStaticCollider(x, 0.48, z, 0.84, 0.95, 0.84);
    const runtime: DestructibleRuntime = {
      mesh, collider, kind: 'barrel', operationId, health: 46, maxHealth: 46, destroyed: false,
    };
    mesh.userData.destructible = runtime;
    mesh.userData.surface = 'metal';
    this.scene.add(mesh);
    this.blockers.push(mesh);
    this.destructibles.push(runtime);
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
    const mesh = new THREE.Mesh(this.sharedBoxGeometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    if (collide) {
      this.blockers.push(mesh);
      this.addStaticCollider(x, y, z, width, height, depth);
    }
    if (y > 1 && height <= 1.2 && width >= 3 && depth >= 3) this.acousticRoofs.push(mesh);
    return mesh;
  }

  private addGroundSlabWithHole(
    x: number,
    z: number,
    width: number,
    depth: number,
    holeX: number,
    holeZ: number,
    holeWidth: number,
    holeDepth: number,
    material: THREE.Material,
  ): void {
    const leftWidth = holeX - holeWidth / 2 - (x - width / 2);
    const rightWidth = x + width / 2 - (holeX + holeWidth / 2);
    const bottomDepth = holeZ - holeDepth / 2 - (z - depth / 2);
    const topDepth = z + depth / 2 - (holeZ + holeDepth / 2);
    if (leftWidth > 0) this.addBox(x - width / 2 + leftWidth / 2, -0.55, z, leftWidth, 1.1, depth, material, true);
    if (rightWidth > 0) this.addBox(x + width / 2 - rightWidth / 2, -0.55, z, rightWidth, 1.1, depth, material, true);
    if (bottomDepth > 0) this.addBox(holeX, -0.55, z - depth / 2 + bottomDepth / 2, holeWidth, 1.1, bottomDepth, material, true);
    if (topDepth > 0) this.addBox(holeX, -0.55, z + depth / 2 - topDepth / 2, holeWidth, 1.1, topDepth, material, true);
  }

  private addStaticCollider(x: number, y: number, z: number, width: number, height: number, depth: number): RAPIER.Collider {
    const body = this.physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    return this.physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2), body);
  }

  private makeTexture(kind: 'asphalt' | 'concrete' | 'metal', base: string, accent: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    context.fillStyle = base;
    context.fillRect(0, 0, 1024, 1024);
    const random = new SeededRandom(kind.length * 913);
    for (let index = 0; index < 14000; index += 1) {
      const alpha = 0.025 + random.next() * 0.1;
      context.fillStyle = `${accent}${Math.floor(alpha * 255).toString(16).padStart(2, '0')}`;
      const size = 1 + random.next() * 5;
      context.fillRect(random.next() * 1024, random.next() * 1024, size, size);
    }
    context.globalAlpha = 0.22;
    context.strokeStyle = accent;
    if (kind === 'asphalt') {
      context.lineWidth = 3;
      for (let index = 0; index < 28; index += 1) {
        const startX = random.next() * 1024;
        const startY = random.next() * 1024;
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(startX + (random.next() - 0.5) * 90, startY + 35 + random.next() * 110);
        context.lineTo(startX + (random.next() - 0.5) * 130, startY + 90 + random.next() * 130);
        context.stroke();
      }
      context.globalAlpha = 0.08;
      context.lineWidth = 14;
      for (const x of [240, 760]) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x + 42, 1024);
        context.stroke();
      }
    } else if (kind === 'concrete') {
      context.lineWidth = 4;
      for (const seam of [256, 512, 768]) {
        context.beginPath();
        context.moveTo(seam, 0);
        context.lineTo(seam, 1024);
        context.stroke();
      }
      context.beginPath();
      context.moveTo(0, 528);
      context.bezierCurveTo(248, 476, 600, 580, 1024, 504);
      context.stroke();
      context.globalAlpha = 0.1;
      for (let index = 0; index < 36; index += 1) {
        const radius = 18 + random.next() * 80;
        context.beginPath();
        context.arc(random.next() * 1024, random.next() * 1024, radius, 0, Math.PI * 2);
        context.stroke();
      }
    } else if (kind === 'metal') {
      for (let x = 0; x < 1024; x += 96) {
        context.fillRect(x, 0, 4, 1024);
      }
      context.globalAlpha = 0.34;
      for (let x = 48; x < 1024; x += 96) {
        for (let y = 48; y < 1024; y += 128) {
          context.beginPath();
          context.arc(x, y, 5, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.lineWidth = 2;
      for (let index = 0; index < 80; index += 1) {
        const x = random.next() * 1024;
        const y = random.next() * 1024;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + 20 + random.next() * 90, y + (random.next() - 0.5) * 18);
        context.stroke();
      }
    }
    context.globalAlpha = 1;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(kind === 'asphalt' ? 18 : 3, kind === 'asphalt' ? 15 : 3);
    const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    texture.anisotropy = this.qualityLevel === 'low' ? 1 : this.qualityLevel === 'medium' ? Math.min(4, maxAnisotropy) : maxAnisotropy;
    return texture;
  }

  private createPlayerPhysics(): void {
    this.playerBody = this.physicsWorld.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(this.activeOperation.spawn.x, 0.9, this.activeOperation.spawn.z),
    );
    this.playerCollider = this.physicsWorld.createCollider(
      RAPIER.ColliderDesc.capsule(0.5, 0.35),
      this.playerBody,
    );
    // A slightly wider skin and normal nudge keep the capsule from resting exactly
    // on a collider edge, which is what causes the sticky wall-corner feeling.
    this.characterController = this.physicsWorld.createCharacterController(0.06);
    this.characterController.setNormalNudgeFactor(1.0);
    this.characterController.setSlideEnabled(true);
    this.characterController.enableAutostep(0.42, 0.18, true);
    this.characterController.enableSnapToGround(0.22);
    this.characterController.setApplyImpulsesToDynamicBodies(true);
  }

  private createWeapon(): void {
    this.weapon = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#4b5750', roughness: 0.4, metalness: 0.62 });
    const gripMaterial = new THREE.MeshStandardMaterial({ color: '#2b302c', roughness: 0.82, metalness: 0.12 });
    const accentMaterial = new THREE.MeshStandardMaterial({ color: '#7b755d', roughness: 0.5, metalness: 0.42 });
    this.weaponReceiver = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.62), bodyMaterial);
    this.weaponReceiver.position.set(0, -0.03, -0.22);
    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.34), accentMaterial);
    handguard.position.set(0, -0.01, -0.58);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.17, 0.3), gripMaterial);
    stock.position.set(0, -0.035, 0.22);
    stock.rotation.x = -0.07;
    const buttPad = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.2, 0.045), gripMaterial);
    buttPad.position.set(0, -0.05, 0.38);
    const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.025, 0.58), accentMaterial);
    topRail.position.set(0, 0.07, -0.3);
    this.weaponBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.54, 10), bodyMaterial);
    this.weaponBarrel.rotation.x = Math.PI / 2;
    this.weaponBarrel.position.set(0, 0.01, -0.73);
    const muzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 12), bodyMaterial);
    muzzleBrake.rotation.x = Math.PI / 2;
    muzzleBrake.position.set(0, 0.01, -1.02);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.12), gripMaterial);
    grip.rotation.x = -0.2;
    grip.position.set(0, -0.16, -0.18);
    this.weaponMagazine = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.25, 0.16), gripMaterial);
    this.weaponMagazine.position.set(0, -0.17, -0.33);
    this.weaponMagazine.rotation.x = -0.12;
    // Keep the front sight low enough that it cannot cover the centre of the view when aiming.
    this.weaponSight = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.028, 0.1), bodyMaterial);
    this.weaponSight.position.set(0, 0.075, -0.31);
    const scopeRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.09, 0.012, 8, 18),
      new THREE.MeshStandardMaterial({ color: '#1b211d', roughness: 0.35, metalness: 0.78 }),
    );
    scopeRing.position.set(0, 0.12, -0.5);
    scopeRing.rotation.x = Math.PI / 2;
    const scopeLens = new THREE.Mesh(
      new THREE.CircleGeometry(0.077, 24),
      new THREE.MeshPhysicalMaterial({
        color: '#d9f6e9',
        transparent: true,
        opacity: 0.035,
        roughness: 0.08,
        metalness: 0,
        transmission: 0.72,
        depthTest: false,
        depthWrite: false,
      }),
    );
    scopeLens.position.set(0, 0.12, -0.503);
    scopeLens.rotation.y = Math.PI;
    const sleeveMaterial = new THREE.MeshStandardMaterial({ color: '#303b32', roughness: 0.96 });
    const gloveMaterial = new THREE.MeshStandardMaterial({ color: '#171c18', roughness: 0.9 });
    this.leftPlayerArm = this.makePlayerArm(sleeveMaterial, gloveMaterial, -1);
    this.rightPlayerArm = this.makePlayerArm(sleeveMaterial, gloveMaterial, 1);
    // Keep both hands tight to the weapon instead of floating at either side of it.
    this.leftPlayerArm.position.set(-0.075, -0.245, -0.42);
    this.rightPlayerArm.position.set(0.055, -0.245, -0.18);
    this.weapon.add(this.weaponReceiver, this.weaponBarrel, grip, this.weaponMagazine, this.weaponSight, scopeRing, scopeLens, this.leftPlayerArm, this.rightPlayerArm);
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
    this.impactMaterials = {
      metal: new THREE.MeshBasicMaterial({ color: '#ffd784', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      wood: new THREE.MeshBasicMaterial({ color: '#9a7147', transparent: true, opacity: 0.82, depthWrite: false }),
      dirt: new THREE.MeshBasicMaterial({ color: '#8b8877', transparent: true, opacity: 0.42, depthWrite: false }),
      armor: new THREE.MeshBasicMaterial({ color: '#87958e', transparent: true, opacity: 0.9, depthWrite: false }),
    };
    const impactGeometry = new THREE.TetrahedronGeometry(0.065, 0);
    for (let index = 0; index < 128; index += 1) {
      const mesh = new THREE.Mesh(impactGeometry, this.impactMaterials.dirt);
      mesh.visible = false;
      this.scene.add(mesh);
      this.impactParticles.push({
        mesh,
        velocity: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        life: 0,
        maxLife: 0.5,
        gravity: 3.8,
        grow: 0,
      });
    }
  }

  private makePlayerArm(sleeveMaterial: THREE.Material, gloveMaterial: THREE.Material, side: number): THREE.Group {
    const arm = new THREE.Group();
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.086, 0.38, 14), sleeveMaterial);
    sleeve.position.y = -0.15;
    sleeve.rotation.z = side * 0.075;

    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.071, 0.07, 14), gloveMaterial);
    cuff.position.y = 0.065;
    const wristStrap = new THREE.Mesh(
      new THREE.TorusGeometry(0.067, 0.008, 5, 14),
      new THREE.MeshStandardMaterial({ color: '#0d110e', roughness: 0.88 }),
    );
    wristStrap.position.y = 0.052;
    wristStrap.rotation.x = Math.PI / 2;

    // A compact curled-fist silhouette looks natural from the first-person camera.
    const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), gloveMaterial);
    palm.scale.set(0.066, 0.074, 0.05);
    palm.position.set(0, 0.135, -0.012);
    palm.rotation.z = side * 0.08;
    const curledFingers = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), gloveMaterial);
    curledFingers.scale.set(0.068, 0.047, 0.057);
    curledFingers.position.set(0, 0.184, -0.038);
    curledFingers.rotation.x = 0.24;

    const padMaterial = new THREE.MeshStandardMaterial({ color: '#292f29', roughness: 0.78 });
    const knucklePads = new THREE.Group();
    for (const x of [-0.043, -0.014, 0.014, 0.043]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), padMaterial);
      pad.scale.set(0.016, 0.013, 0.009);
      pad.position.set(x, 0.202, 0.008);
      knucklePads.add(pad);
    }

    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.038, 5, 8), gloveMaterial);
    thumb.position.set(side * 0.05, 0.132, -0.027);
    thumb.rotation.x = 0.42;
    thumb.rotation.z = side * 0.78;

    arm.add(sleeve, cuff, wristStrap, palm, curledFingers, knucklePads, thumb);
    arm.rotation.x = -0.88;
    arm.rotation.z = side * 0.035;
    return arm;
  }

  private applyWeaponVisual(): void {
    if (!this.weaponReceiver || !this.weaponBarrel) return;
    const config = this.getWeaponConfig(this.activeWeaponId);
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

    this.missionTerminal = this.makeMissionTerminal();
    this.missionTerminal.position.set(RESERVOIR_TERMINAL.x, RESERVOIR_TERMINAL.y, RESERVOIR_TERMINAL.z);
    this.missionTerminal.visible = false;
    this.scene.add(this.missionTerminal);

    this.taskHardDrive = this.makeSupplyCase('#242b28', '#e3bd43');
    this.taskHardDrive.scale.setScalar(0.52);
    this.taskHardDrive.visible = false;
    this.scene.add(this.taskHardDrive);

    this.taskRadio = this.makeMissionTerminal();
    this.taskRadio.scale.setScalar(0.82);
    this.taskRadio.visible = false;
    this.scene.add(this.taskRadio);

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
      operation.loot.forEach(([x, z, tier, floorY], index) => {
        const rule = CONTAINER_RULES[tier];
        const y = floorY ?? 0.04;
        const mesh = this.makeLootContainer(tier);
        mesh.scale.setScalar(rule.scale);
        mesh.position.set(x, y, z);
        mesh.rotation.y = random.next() * Math.PI;
        mesh.visible = operation.id === this.activeOperation.id;
        this.scene.add(mesh);
        this.loot.push({
          mesh,
          position: new THREE.Vector3(x, y, z),
          operationId: operation.id,
          tier,
          containerName: rule.name,
          items: this.rollContainerLoot(tier, new SeededRandom(1709 + index * 71 + operation.id.length * 997), operation.id),
          equipment: [],
          opened: false,
          source: 'container',
          capacity: rule.max,
          boss: false,
        });
      });
    }
  }

  private makeMissionTerminal(): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 1.25, 0.22),
      new THREE.MeshStandardMaterial({ color: '#343d38', roughness: 0.62, metalness: 0.44 }),
    );
    body.position.y = 0.64;
    body.castShadow = true;
    const screenMaterial = new THREE.MeshStandardMaterial({
      color: '#d6a438', emissive: '#6b3608', emissiveIntensity: 1.8, roughness: 0.2,
    });
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.42, 0.035), screenMaterial);
    screen.position.set(0, 0.77, 0.13);
    const keypad = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.28, 0.04),
      new THREE.MeshStandardMaterial({ color: '#151b18', roughness: 0.76, metalness: 0.22 }),
    );
    keypad.position.set(0, 0.35, 0.14);
    const light = new THREE.PointLight('#ffad42', 1.8, 5, 2);
    light.position.set(0, 0.8, 0.5);
    group.add(body, screen, keypad, light);
    group.userData.screen = screen;
    group.userData.light = light;
    return group;
  }

  private setMissionTerminalActive(active: boolean): void {
    this.setTerminalActive(this.missionTerminal, active);
  }

  private setTerminalActive(terminal: THREE.Group, active: boolean): void {
    const screen = terminal.userData.screen as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> | undefined;
    const light = terminal.userData.light as THREE.PointLight | undefined;
    if (screen) {
      screen.material.color.set(active ? '#8ee59f' : '#d6a438');
      screen.material.emissive.set(active ? '#1b7835' : '#6b3608');
    }
    if (light) {
      light.color.set(active ? '#79ff9a' : '#ffad42');
      light.intensity = active ? 2.4 : 1.8;
    }
    this.ensureAdministrationAccessCard();
  }

  private ensureAdministrationAccessCard(): void {
    const outdoorContainer = this.loot.find((entry) =>
      entry.operationId === 'administration'
      && Math.abs(entry.position.x - 121) < 0.1
      && Math.abs(entry.position.z - 57) < 0.1,
    );
    if (!outdoorContainer) return;
    const otherItems = outdoorContainer.items.filter((item) => item.id !== ADMIN_SECRET_CARD_ID);
    outdoorContainer.items = [
      { ...ADMIN_SECRET_CARD },
      ...otherItems.slice(0, Math.max(0, outdoorContainer.capacity - 1)),
    ];
  }

  private configureHighValueTask(): void {
    const config = HIGH_VALUE_TASKS[this.activeOperation.id];
    this.highValueTaskStage = config ? 'clear' : 'inactive';
    this.taskHardDrive.visible = false;
    this.taskRadio.visible = Boolean(config);
    this.setTerminalActive(this.taskRadio, false);
    if (!config) return;
    this.taskHardDrive.position.set(config.drive.x, config.drive.y, config.drive.z);
    this.taskRadio.position.set(config.radio.x, config.radio.y, config.radio.z);
  }

  private updateHighValueTask(): void {
    if (this.highValueTaskStage !== 'clear') return;
    if (this.enemies.some((enemy) => enemy.alive)) return;
    this.highValueTaskStage = 'collect';
    this.taskHardDrive.visible = true;
    this.callbacks.onToast('区域已肃清 · 高价值硬盘位置已标记');
    this.audio.tone(720, 0.2, 0.06);
    this.callbacks.onMiniMap(this.createMiniMapView());
  }

  private takeHighValueTaskItem(): void {
    if (this.highValueTaskStage !== 'collect') return;
    const config = HIGH_VALUE_TASKS[this.activeOperation.id];
    if (!config) return;
    this.highValueTaskStage = 'deliver';
    this.taskHardDrive.visible = false;
    this.setTerminalActive(this.taskRadio, true);
    this.callbacks.onPrompt(null);
    this.callbacks.onToast(`${config.driveLabel}已取得 · 前往军用电台交付`);
    this.audio.tone(810, 0.16, 0.055);
    this.callbacks.onMiniMap(this.createMiniMapView());
  }

  private deliverHighValueTaskItem(): void {
    if (this.highValueTaskStage !== 'deliver') return;
    this.highValueTaskStage = 'complete';
    const rewarded = addInventoryItem(this.run.backpack, HIGH_VALUE_TASK_REWARD, Number.POSITIVE_INFINITY);
    this.run.backpack = rewarded.items;
    this.setTerminalActive(this.taskRadio, true);
    this.callbacks.onPrompt(null);
    this.callbacks.onToast('高价值任务完成 · 获得大红非洲之心（50,000）');
    this.audio.tone(980, 0.42, 0.09);
    this.callbacks.onUpdate(this.run);
    this.callbacks.onMiniMap(this.createMiniMapView());
  }

  private rollContainerLoot(tier: ContainerTier, random: SeededRandom, operationId: MapId = this.activeOperation.id): InventoryItem[] {
    const rule = CONTAINER_RULES[tier];
    const weights = operationId === 'administration' && tier !== 'vault'
      ? rule.weights.map((weight, index) => index === 5 ? weight * 1.8 : index === 6 ? 0 : weight)
      : rule.weights;
    const count = rule.min + Math.floor(random.next() * (rule.max - rule.min + 1));
    const results: InventoryItem[] = [];
    for (let index = 0; index < count; index += 1) {
      let rarity: InventoryItem['rarity'] = 'red';
      if (operationId !== 'administration' || random.next() >= ADMIN_RED_DROP_CHANCE) {
        const total = weights.reduce((sum, weight) => sum + weight, 0);
        let roll = random.next() * total;
        rarity = RARITY_ORDER[0];
        for (let rarityIndex = 0; rarityIndex < weights.length; rarityIndex += 1) {
          roll -= weights[rarityIndex];
          if (roll <= 0) {
            rarity = RARITY_ORDER[rarityIndex];
            break;
          }
        }
      }
      const pool = lootPoolForContainer(tier, rarity);
      const source = random.pick(pool);
      const quantity = ['black', 'white', 'green'].includes(source.rarity) && random.next() > 0.55 ? 2 : 1;
      const unidentified = ['safe', 'vault', 'hidden'].includes(tier)
        && ['purple', 'gold', 'red'].includes(source.rarity)
        && random.next() < 0.28;
      const rolledItem: InventoryItem = unidentified
        ? {
            ...source,
            name: '未知密封包装',
            value: 0,
            quantity,
            identified: false,
            trueName: source.name,
            trueValue: source.value,
            description: '包装无法在战区内安全拆解，成功撤离后由后勤自动鉴定。',
          }
        : { ...source, quantity };
      const existing = results.find((item) => item.id === rolledItem.id && item.identified === rolledItem.identified);
      if (existing) existing.quantity += quantity;
      else results.push(rolledItem);
    }
    return results;
  }

  private rollEnemyLoot(enemy: EnemyRuntime, random: SeededRandom): InventoryItem[] {
    const weights = enemy.boss
      ? [0, 1, 5, 14, 27, 38, 15]
      : enemy.elite
        ? [2, 10, 25, 29, 22, 10.5, 1.5]
        : [10, 27, 31, 20, 9, 2.7, 0.3];
    const minimum = enemy.boss ? 6 : enemy.elite ? 3 : 2;
    const maximum = enemy.boss ? 8 : enemy.elite ? 5 : 4;
    const count = minimum + Math.floor(random.next() * (maximum - minimum + 1));
    const results: InventoryItem[] = [];
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    for (let index = 0; index < count; index += 1) {
      let roll = random.next() * total;
      let rarity = RARITY_ORDER[0];
      for (let rarityIndex = 0; rarityIndex < weights.length; rarityIndex += 1) {
        roll -= weights[rarityIndex];
        if (roll <= 0) {
          rarity = RARITY_ORDER[rarityIndex];
          break;
        }
      }
      const source = random.pick(LOOT_POOLS[rarity]);
      const quantity = ['black', 'white', 'green'].includes(rarity) && random.next() > 0.62 ? 2 : 1;
      const existing = results.find((item) => item.id === source.id);
      if (existing) existing.quantity += quantity;
      else results.push({ ...source, quantity });
    }
    if (enemy.bossReward) results.unshift({ ...enemy.bossReward });
    return results;
  }

  private spawnCorpseBackpack(enemy: EnemyRuntime): void {
    const backpack = this.makeLootContainer('bag');
    const scale = enemy.boss ? 1.08 : enemy.elite ? 0.88 : 0.76;
    backpack.scale.setScalar(scale);
    const position = new THREE.Vector3(
      enemy.group.position.x - enemy.facing.z * 0.34,
      enemy.floorY + 0.05,
      enemy.group.position.z + enemy.facing.x * 0.34,
    );
    backpack.position.copy(position);
    backpack.rotation.y = enemy.group.rotation.y + Math.PI * 0.18;
    this.scene.add(backpack);
    const armorClass: EnemyArmorClass = enemy.boss ? 'boss' : enemy.elite ? 'elite' : 'regular';
    const equipment = createRecoveredEnemyEquipment(
      `recovered-equipment-${this.activeOperation.id}-${this.run.kills}-${this.corpseLoot.length}`,
      armorClass,
      enemy.weaponId,
      enemy.armorDurability,
      enemy.armorMaxDurability,
    );
    const items = this.rollEnemyLoot(enemy, new SeededRandom(Math.floor(performance.now()) + this.run.kills * 7919));
    this.corpseLoot.push({
      mesh: backpack,
      position,
      operationId: this.activeOperation.id,
      tier: 'bag',
      containerName: enemy.boss ? `${enemy.name}的指挥背包` : `${enemy.name}的战术背包`,
      items,
      equipment,
      opened: false,
      source: 'corpse',
      capacity: enemy.boss ? 16 : enemy.elite ? 8 : 6,
      boss: enemy.boss,
    });
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

  private makeLootContainer(tier: ContainerTier): THREE.Group {
    const cached = this.containerPrototypes.get(tier);
    if (cached) return this.cloneLootContainer(cached, tier);

    const group = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: '#303732', roughness: 0.72, metalness: 0.3 });
    const green = new THREE.MeshStandardMaterial({ color: '#526451', roughness: 0.78, metalness: 0.24 });
    const olive = new THREE.MeshStandardMaterial({ color: '#737a55', roughness: 0.76, metalness: 0.22 });
    const steel = new THREE.MeshStandardMaterial({ color: '#707a75', roughness: 0.58, metalness: 0.55 });
    const tan = new THREE.MeshStandardMaterial({ color: '#7b6650', roughness: 0.9, metalness: 0.06 });
    const red = new THREE.MeshStandardMaterial({ color: '#a43b33', roughness: 0.62, metalness: 0.2 });
    const white = new THREE.MeshStandardMaterial({ color: '#d0d4c9', roughness: 0.72, metalness: 0.12 });
    const screen = new THREE.MeshStandardMaterial({ color: '#78b9a8', emissive: '#174c42', emissiveIntensity: 1.4, roughness: 0.18 });
    const glow = new THREE.MeshBasicMaterial({ color: '#b9e986' });
    const part = (width: number, height: number, depth: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };
    let lid: THREE.Mesh;

    if (tier === 'bag') {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 10), tan);
      body.scale.set(1.2, 0.48, 0.72);
      body.position.y = 0.28;
      body.castShadow = true;
      group.add(body);
      lid = part(0.82, 0.08, 0.5, dark, 0, 0.53, -0.03);
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 16, Math.PI), dark);
      strap.position.set(0, 0.6, 0);
      strap.rotation.x = Math.PI / 2;
      group.add(strap);
    } else if (tier === 'computer') {
      part(0.86, 0.12, 0.6, dark, 0, 0.08, 0);
      part(0.6, 0.07, 0.34, steel, -0.04, 0.18, -0.02);
      part(0.08, 0.42, 0.08, steel, 0, 0.39, 0.12);
      lid = part(0.72, 0.48, 0.08, dark, 0, 0.68, 0.12);
      part(0.62, 0.36, 0.015, screen, 0, 0.68, 0.075);
    } else if (tier === 'server' || tier === 'locker') {
      const bodyMaterial = tier === 'server' ? dark : steel;
      part(0.82, 1.8, 0.72, bodyMaterial, 0, 0.9, 0);
      lid = part(0.7, 1.62, 0.07, tier === 'server' ? steel : green, 0, 0.9, -0.39);
      for (let y = 0.3; y <= 1.5; y += 0.3) {
        part(0.42, 0.025, 0.018, tier === 'server' ? glow : dark, -0.08, y, -0.43);
      }
      part(0.06, 0.18, 0.04, dark, 0.24, 0.9, -0.45);
    } else if (tier === 'safe' || tier === 'vault') {
      const size = tier === 'vault' ? 1.25 : 1;
      part(size, size, 0.82, dark, 0, size / 2, 0);
      lid = part(size * 0.86, size * 0.82, 0.08, steel, 0, size * 0.53, -0.45);
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.09, 20), tier === 'vault' ? red : olive);
      dial.rotation.x = Math.PI / 2;
      dial.position.set(0.12, size * 0.55, -0.51);
      group.add(dial);
      part(0.05, 0.32, 0.05, tier === 'vault' ? red : steel, -0.22, size * 0.55, -0.52);
    } else {
      const long = tier === 'weapon' ? 1.75 : tier === 'briefcase' ? 1.05 : 1.2;
      const high = tier === 'medical' ? 0.48 : tier === 'toolbox' ? 0.42 : tier === 'hidden' ? 0.36 : 0.4;
      const bodyMaterial = tier === 'medical' ? white : tier === 'toolbox' ? red : tier === 'briefcase' ? tan : tier === 'hidden' ? dark : green;
      part(long, high, 0.72, bodyMaterial, 0, high / 2, 0);
      lid = part(long * 1.02, 0.14, 0.74, bodyMaterial, 0, high + 0.07, 0);
      const trimMaterial = tier === 'medical' ? red : tier === 'weapon' ? olive : steel;
      part(0.08, high + 0.14, 0.76, trimMaterial, -long * 0.34, (high + 0.14) / 2, 0);
      part(0.08, high + 0.14, 0.76, trimMaterial, long * 0.34, (high + 0.14) / 2, 0);
      if (tier === 'medical') {
        part(0.32, 0.08, 0.015, red, 0, high + 0.155, -0.18);
        part(0.08, 0.08, 0.32, red, 0, high + 0.155, -0.18);
      }
      if (tier === 'briefcase' || tier === 'toolbox') {
        const handle = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 16, Math.PI), dark);
        handle.position.set(0, high + 0.2, 0);
        handle.rotation.x = Math.PI / 2;
        group.add(handle);
      }
      if (tier === 'hidden') {
        const cover = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.35, 7), tan);
        cover.position.set(0.15, 0.5, 0.04);
        cover.rotation.z = 0.4;
        group.add(cover);
      }
    }

    lid.name = 'loot-container-lid';
    this.containerPrototypes.set(tier, group);
    return this.cloneLootContainer(group, tier);
  }

  private cloneLootContainer(prototype: THREE.Group, tier: ContainerTier): THREE.Group {
    const group = prototype.clone(true);
    const lid = group.getObjectByName('loot-container-lid') as THREE.Mesh | undefined;
    if (!lid) throw new Error(`物资箱 ${tier} 缺少可开合部件`);
    this.configureContainerPart(lid, tier === 'server' || tier === 'locker' || tier === 'safe' || tier === 'vault');
    group.userData = { lid };
    return group;
  }

  private configureContainerPart(part: THREE.Mesh, swingsSideways: boolean): void {
    part.userData.closedPosition = part.position.clone();
    part.userData.closedQuaternion = part.quaternion.clone();
    const openPosition = part.position.clone();
    const openQuaternion = part.quaternion.clone();
    if (swingsSideways) {
      openPosition.x += 0.32;
      openQuaternion.setFromEuler(new THREE.Euler(0, -1.22, 0));
    } else {
      openPosition.y += 0.24;
      openPosition.z += 0.12;
      openQuaternion.setFromEuler(new THREE.Euler(-0.9, 0, 0));
    }
    part.userData.openPosition = openPosition;
    part.userData.openQuaternion = openQuaternion;
  }

  private setContainerOpenProgress(mesh: THREE.Group, progress: number): void {
    const lid = mesh.userData.lid as THREE.Mesh | undefined;
    if (!lid) return;
    const closedPosition = lid.userData.closedPosition as THREE.Vector3 | undefined;
    const openPosition = lid.userData.openPosition as THREE.Vector3 | undefined;
    const closedQuaternion = lid.userData.closedQuaternion as THREE.Quaternion | undefined;
    const openQuaternion = lid.userData.openQuaternion as THREE.Quaternion | undefined;
    if (!closedPosition || !openPosition || !closedQuaternion || !openQuaternion) {
      lid.position.y = 0.2 + progress * 0.22;
      lid.position.z = -progress * 0.08;
      lid.rotation.x = -progress * 0.82;
      return;
    }
    lid.position.lerpVectors(closedPosition, openPosition, progress);
    lid.quaternion.slerpQuaternions(closedQuaternion, openQuaternion, progress);
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
    this.clearAbilities();
    for (const enemy of this.enemies) {
      this.scene.remove(enemy.group);
      this.disposeDynamicObject(enemy.group);
    }
    for (const entry of this.corpseLoot) this.scene.remove(entry.mesh);
    for (const tracer of this.tracers) {
      tracer.life = 0;
      tracer.mesh.visible = false;
    }
    for (const shell of this.shells) {
      shell.life = 0;
      shell.mesh.visible = false;
    }
    for (const particle of this.bloodParticles) {
      particle.life = 0;
      particle.mesh.visible = false;
    }
    for (const particle of this.impactParticles) {
      particle.life = 0;
      particle.mesh.visible = false;
    }
    for (const destructible of this.destructibles) {
      destructible.destroyed = false;
      destructible.health = destructible.maxHealth;
      destructible.mesh.visible = true;
      destructible.collider?.setEnabled(true);
      if (destructible.linkedLight) {
        destructible.linkedLight.userData.broken = false;
      }
    }
    this.enemies.length = 0;
    this.corpseLoot.length = 0;
    this.enemyHitMeshes.length = 0;
    this.entityManager = new YUKA.EntityManager();
    this.focusedBoss = null;
    this.callbacks.onBossUpdate(null);
    this.administrationEntered = false;
    this.resetAdministrationSecretRoom();
    this.reservoirTunnelEntered = false;
    this.reservoirTerminalActivated = false;
    this.missionTerminal.visible = this.activeOperation.id === 'reservoir';
    this.setMissionTerminalActive(false);
    this.configureHighValueTask();
    const taskUsesObjective = ['rescue', 'plant-bomb', 'escort'].includes(this.operationScenario.task.type);
    this.objectiveCase.visible = isObjectiveCarryMode(this.activeGameMode) || taskUsesObjective;
    this.lastDamagedAt = -100;
    this.lastShotAt = -100;
    this.lastPlayerNoiseAt = -100;
    this.lastPlayerNoisePosition.set(0, 0, 0);
    this.lastPlayerNoiseRadius = 0;
    this.nextShotAt = 0;
    this.recoilShotIndex = 0;
    this.weaponRecoilKick = 0;
    this.weaponAction = 'idle';
    this.reloadStage = 0;
    this.reloadStyle = 'tactical';
    this.activeReloadDuration = 1;
    this.weaponWallBlend = 0;
    this.weaponWallBlocked = false;
    this.weaponHurtStartedAt = -100;
    this.weaponHurtEndsAt = -100;
    this.muzzleFlashEndsAt = -100;
    if (this.muzzleFlash) this.muzzleFlash.visible = false;
    this.healingEndsAt = 0;
    this.healingTreatment = 'medkit';
    this.firing = false;
    this.setAiming(false);
    this.cancelLootSearch();
    this.loot.forEach((entry) => {
      entry.opened = false;
      entry.mesh.visible = entry.operationId === this.activeOperation.id;
      if (entry.operationId === this.activeOperation.id) {
        const seed = Math.floor(performance.now()) + entry.position.x * 31 + entry.position.z * 17;
        const lootRandom = new SeededRandom(seed);
        entry.items = this.rollContainerLoot(entry.tier, lootRandom, entry.operationId);
        if (this.isHighRiskPosition(entry.position)) this.enrichHighRiskLoot(entry.items, lootRandom);
      }
      const lid = entry.mesh.userData.lid as THREE.Mesh | undefined;
      if (lid) {
        this.setContainerOpenProgress(entry.mesh, 0);
      }
    });
    this.ensureAdministrationAccessCard();
    this.objectiveCase.position.set(this.activeOperation.objective.x, 0.42, this.activeOperation.objective.z);
    this.extractionMarker.position.set(this.activeOperation.extraction.x, 0.035, this.activeOperation.extraction.z);
    this.extractionBeam.position.set(this.activeOperation.extraction.x, 17, this.activeOperation.extraction.z);
    this.extractionRing.position.set(this.activeOperation.extraction.x, 0.12, this.activeOperation.extraction.z);
    this.extractionLabel.position.set(this.activeOperation.extraction.x, 7.2, this.activeOperation.extraction.z);
    this.extractionBeacon.position.set(this.activeOperation.extraction.x, 0, this.activeOperation.extraction.z);
    this.extractionLight.position.set(this.activeOperation.extraction.x, 4.8, this.activeOperation.extraction.z);
    this.extractionSmoke.position.set(this.activeOperation.extraction.x, 0.4, this.activeOperation.extraction.z);
    this.createEnemies();
    this.designatedGuard = this.enemies.find((enemy) => enemy.role === 'captain' && enemy.alive)
      ?? this.enemies.find((enemy) => enemy.boss && enemy.alive)
      ?? null;
    if (this.challengeDefinitions[0]?.kind === 'extract-item') {
      const targetContainer = this.loot.find((entry) =>
        entry.operationId === this.activeOperation.id
        && !entry.opened
        && !entry.items.some((item) => item.id === ADMIN_SECRET_CARD_ID),
      );
      if (targetContainer) {
        const challengeItem: InventoryItem = {
          id: 'challenge-package', name: '指定回收样本', kind: 'intel', rarity: 'purple', value: 3200, quantity: 1,
          description: '小型挑战指定物品，成功带出可获得额外奖励。',
        };
        const otherItems = targetContainer.items.filter((item) => item.id !== challengeItem.id);
        targetContainer.items = [challengeItem, ...otherItems.slice(0, Math.max(0, targetContainer.capacity - 1))];
      }
    }
    this.teleport(this.activeOperation.spawn.x, this.activeOperation.spawn.z);
    this.syncMissionObjectiveText();
    this.callbacks.onPrompt(null);
    this.emitOperationStatus();
  }

  private configureOperationSystems(): void {
    const seed = this.operationSeed || `${this.activeOperation.id}-${this.activeDifficulty}-${Math.floor(performance.now())}`;
    this.operationScenario = createOperationScenario(seed);
    this.operationTaskProgress = createTaskProgress(this.operationScenario.task);
    this.extractionConditionProgress = advanceExtractionCondition(this.operationScenario.extractionCondition, 0, 0);
    const challengeChoices = [
      ...DEFAULT_CHALLENGES,
      createExtractItemChallenge('challenge-package', '指定物品回收'),
    ];
    const dateKey = new Date().toLocaleDateString('en-CA');
    const challengeIndex = dailyChallengeIndex(dateKey, challengeChoices.length);
    this.challengeDefinitions = [challengeChoices[challengeIndex]];
    this.challengeProgress = [createChallengeProgress(this.challengeDefinitions[0])];
    const eventTimingRandom = createOperationScenario(`${seed}-timing`).event.durationSeconds;
    this.eventStartsAt = 28 + eventTimingRandom % 32;
    this.eventEndsAt = 0;
    this.eventStarted = false;
    this.operationTaskRevealed = false;
    this.operationTaskRevealedAt = 0;
    this.nextGasDamageAt = 0;
    this.nextLootThreatPulseAt = 12;
    this.currentRiskHigh = false;
    this.threatEscalation = getThreatEscalation(0);
    this.lastThreatLevelToast = 0;
    this.designatedGuard = null;
    this.operationTaskRewardGranted = false;
  }

  private isHighRiskPosition(position: { x: number; z: number }): boolean {
    const radius = this.operationScenario?.risk === 'high-risk' ? 78 : 52;
    return Math.hypot(position.x - this.activeOperation.objective.x, position.z - this.activeOperation.objective.z) <= radius;
  }

  private enrichHighRiskLoot(items: InventoryItem[], random: SeededRandom): void {
    const roll = random.next();
    const rarity = roll < 0.08 ? 'red' : roll < 0.38 ? 'gold' : null;
    if (!rarity) return;
    const source = random.pick(LOOT_POOLS[rarity]);
    const replaceIndex = items.findIndex((item) => ['black', 'white', 'green'].includes(item.rarity));
    if (replaceIndex >= 0) items.splice(replaceIndex, 1, { ...source, quantity: 1 });
    else items.push({ ...source, quantity: 1 });
  }

  private makeEnemyFabricTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    context.fillStyle = '#586157';
    context.fillRect(0, 0, 64, 64);
    let seed = 19373;
    const random = (): number => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    const tones = ['#40483f', '#6c7468', '#4d564d', '#788073'];
    for (let index = 0; index < 48; index += 1) {
      context.globalAlpha = 0.18 + random() * 0.2;
      context.fillStyle = tones[Math.floor(random() * tones.length)];
      const width = 5 + random() * 12;
      const height = 3 + random() * 8;
      context.fillRect(random() * 64 - width * 0.5, random() * 64 - height * 0.5, width, height);
    }
    context.globalAlpha = 0.12;
    context.strokeStyle = '#d4d8ce';
    context.lineWidth = 0.5;
    for (let line = 1; line < 64; line += 4) {
      context.beginPath();
      context.moveTo(0, line);
      context.lineTo(64, line + 1);
      context.stroke();
    }
    context.globalAlpha = 1;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.5, 2.5);
    texture.anisotropy = 2;
    return texture;
  }

  private createEnemies(): void {
    const random = new SeededRandom(91173);
    const difficulty = DIFFICULTIES[this.activeDifficulty];
    const training = this.activeGameMode === 'training';
    const bossPositions = this.activeOperation.enemies.filter((entry) => entry[2]);
    const selectedBossPositions = this.activeBossMode === 'single' ? bossPositions.slice(-1) : bossPositions;
    const regularPositions = this.activeOperation.enemies.filter((entry) => !entry[2]);
    const regularCount = training ? 0 : Math.max(4, Math.ceil(
      regularPositions.length * difficulty.enemyCount * gameModeDefinition(this.activeGameMode).enemyMultiplier,
    ));
    const enemyPositions = [...regularPositions.slice(0, regularCount), ...selectedBossPositions];
    const enemySpawns = enemyPositions.map(([x, z, boss]) => ({ x, z, boss: Boolean(boss), reinforcement: false, trainingTarget: false, trainingDistance: 0, trainingArmorLevel: 0 }));
    let bossIndex = bossPositions.length - selectedBossPositions.length;
    const shoulderGeometry = new THREE.BoxGeometry(0.28, 0.2, 0.34);
    const hardArmor = new THREE.MeshStandardMaterial({ color: '#303833', roughness: 0.52, metalness: 0.46 });
    enemySpawns.forEach(({
      x, z, boss: isBoss, reinforcement, trainingTarget, trainingDistance, trainingArmorLevel,
    }, index) => {
      const group = new THREE.Group();
      const torso = new THREE.Group();
      const headRig = new THREE.Group();
      const boss = Boolean(isBoss);
      const faction: EnemyFaction = boss || index % 2 === 0 ? 'security' : 'raider';
      const bossProfile = boss ? BOSS_PROFILES[this.activeOperation.id][bossIndex++] : null;
      const role: EnemyRoleId = boss ? 'captain' : selectEnemyRole(index, this.activeDifficulty);
      const roleConfig = getEnemyRoleConfig(role);
      const weaponId: EnemyWeaponId = boss
        ? bossIndex % 2 === 1 ? 'smg' : 'shotgun'
        : roleConfig.weaponPreference[index % roleConfig.weaponPreference.length];
      const weaponConfig = ENEMY_WEAPON_CONFIGS[weaponId];
      const elite = trainingTarget ? false : boss || index % 5 === 0 || (this.activeDifficulty === 'veteran' && index % 3 === 0);
      const uniform = new THREE.MeshStandardMaterial({ color: boss ? '#252929' : roleConfig.color, roughness: 0.86 });
      const vest = new THREE.MeshStandardMaterial({ color: '#252b26', roughness: 0.8 });
      const skin = new THREE.MeshStandardMaterial({ color: '#9c806d', roughness: 0.9 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.38), uniform);
      body.position.y = 1.1;
      body.castShadow = true;
      const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.34, 0.4), uniform);
      pelvis.position.set(0, 0.68, 0);
      pelvis.castShadow = true;
      const armor = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.32), vest);
      armor.position.set(0, 1.2, 0.07);
      armor.castShadow = true;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), skin);
      head.position.y = 1.82;
      head.castShadow = true;
      const helmet = new THREE.Mesh(
        new THREE.BoxGeometry(elite ? 0.56 : 0.48, 0.22, elite ? 0.58 : 0.48),
        new THREE.MeshStandardMaterial({ color: elite ? '#111716' : '#2a302b', roughness: 0.55, metalness: elite ? 0.48 : 0.22 }),
      );
      helmet.position.set(0, 2.04, 0);
      helmet.castShadow = true;
      const visor = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.08, 0.045),
        new THREE.MeshBasicMaterial({ color: boss ? '#ffb129' : elite ? '#ff2f24' : '#a3c96c' }),
      );
      visor.position.set(0, 1.87, 0.225);
      const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.82, 0.2), uniform);
      const rightArm = leftArm.clone();
      const leftElbow = new THREE.Group();
      const rightElbow = new THREE.Group();
      leftArm.userData.elbow = leftElbow;
      rightArm.userData.elbow = rightElbow;
      leftArm.position.set(-0.46, 1.08, 0);
      rightArm.position.set(0.46, 1.08, 0);
      leftArm.castShadow = true;
      rightArm.castShadow = true;
      const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.78, 0.24), uniform);
      const rightLeg = leftLeg.clone();
      const leftKnee = new THREE.Group();
      const rightKnee = new THREE.Group();
      const bootMaterial = new THREE.MeshStandardMaterial({ color: '#1b211d', roughness: 0.9, metalness: 0.08 });
      const leftBoot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.38), bootMaterial);
      const rightBoot = leftBoot.clone();
      leftLeg.userData.knee = leftKnee;
      rightLeg.userData.knee = rightKnee;
      leftLeg.userData.boot = leftBoot;
      rightLeg.userData.boot = rightBoot;
      leftLeg.position.set(-0.19, 0.34, 0);
      rightLeg.position.set(0.19, 0.34, 0);
      leftLeg.castShadow = true;
      rightLeg.castShadow = true;
      const weapon = this.makeEnemyWeapon(weaponId, vest, elite);
      const alertLight = new THREE.PointLight('#ff2e24', 0, 7, 2.2);
      alertLight.position.set(0, 2.1, 0.25);
      alertLight.visible = false;
      const muzzleLight = new THREE.PointLight('#ff9b4a', 0, 6, 2);
      muzzleLight.position.set(0.32, 1.18, weaponId === 'sniper' ? 1.08 : weaponId === 'shotgun' ? 0.94 : 0.82);
      muzzleLight.visible = false;
      const shoulderLeft = new THREE.Mesh(shoulderGeometry, uniform);
      const shoulderRight = shoulderLeft.clone();
      shoulderLeft.position.set(-0.32, 1.47, 0);
      shoulderRight.position.set(0.32, 1.47, 0);
      shoulderLeft.material = hardArmor;
      shoulderRight.material = hardArmor;
      shoulderLeft.scale.set(0.52, 0.58, 0.56);
      shoulderRight.scale.copy(shoulderLeft.scale);
      torso.add(shoulderLeft, shoulderRight);
      if (elite) {
        armor.scale.multiplyScalar(1.12);
        body.scale.x = 1.12;
      }
      if (boss) {
        group.scale.set(1.28, 1.18, 1.28);
        const shoulderLeft = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.24, 0.46), vest);
        const shoulderRight = shoulderLeft.clone();
        shoulderLeft.position.set(-0.42, 1.48, 0);
        shoulderRight.position.set(0.42, 1.48, 0);
        shoulderLeft.scale.set(1.25, 0.72, 1.08);
        shoulderRight.scale.copy(shoulderLeft.scale);
        torso.add(shoulderLeft, shoulderRight);
      }
      if (role === 'shield') {
        const shield = new THREE.Mesh(
          new THREE.BoxGeometry(0.82, 1.2, 0.12),
          new THREE.MeshStandardMaterial({ color: '#26333a', roughness: 0.48, metalness: 0.62 }),
        );
        shield.position.set(0, 1.08, 0.42);
        shield.castShadow = true;
        torso.add(shield);
      }
      group.add(torso, headRig, body, armor, head, helmet, visor, leftArm, rightArm, leftLeg, rightLeg, weapon, alertLight, muzzleLight);
      group.position.set(x, 0, z);
      group.visible = !reinforcement;
      this.scene.add(group);

      const vehicle = new YUKA.Vehicle();
      vehicle.position.set(x, 0, z);
      vehicle.maxSpeed = trainingTarget ? 0 : boss
        ? ENEMY_WALK_SPEED * getBossCombatTuning(1, 1, this.activeDifficulty).speedMultiplier
        : roleConfig.speed;
      vehicle.maxForce = 5;
      const path = new YUKA.Path();
      path.loop = true;
      path.add(new YUKA.Vector3(x, 0, z));
      path.add(new YUKA.Vector3(x + (random.next() - 0.5) * 12, 0, z + (random.next() - 0.5) * 12));
      path.add(new YUKA.Vector3(x + (random.next() - 0.5) * 12, 0, z + (random.next() - 0.5) * 12));
      vehicle.steering.add(new YUKA.FollowPathBehavior(path, 0.7));
      const seek = new YUKA.SeekBehavior(new YUKA.Vector3(x, 0, z));
      const maxHealth = trainingTarget
        ? 100
        : Math.round((boss ? 82 * 14 : roleConfig.health * (elite ? 1.35 : 1)) * difficulty.health);
      const armorMaxDurability = trainingTarget
        ? 55 + trainingArmorLevel * 22
        : Math.round((boss ? 190 : roleConfig.armor * (elite ? 1.45 : 1)) * difficulty.health);
      const runtime: EnemyRuntime = {
        group,
        torso,
        headRig,
        body,
        armor,
        head,
        leftArm,
        rightArm,
        leftLeg,
        rightLeg,
        weapon,
        weaponId,
        role,
        faction,
        factionTarget: null,
        factionFireCooldown: 0.8 + random.next() * 0.8,
        lastRoleActionAt: -100,
        vehicle,
        path,
        seek,
        state: 'patrol',
        health: maxHealth,
        home: new THREE.Vector3(x, 0, z),
        facing: new THREE.Vector3(0, 0, 1),
        lastSeen: new THREE.Vector3(x, 0, z),
        perception: { awareness: 0, lastVisualAt: -100 },
        lastStateChange: 0,
        fireCooldown: 0.5 + random.next(),
        burstRemaining: 0,
        ammo: weaponConfig.magazineSize,
        reloading: false,
        reloadEndsAt: 0,
        hurtEndsAt: -100,
        lastFiredAt: -100,
        deathStartedAt: -100,
        deathSide: random.next() > 0.5 ? 1 : -1,
        tactic: 'advance',
        tacticalTarget: new THREE.Vector3(x, 0, z),
        nextTacticAt: 0,
        flankSide: random.next() > 0.5 ? 1 : -1,
        lastCallAt: -100,
        attackWarning: { phase: 'idle', readyAt: 0 },
        lastSuppressedAt: Number.NEGATIVE_INFINITY,
        searchCenter: new THREE.Vector3(x, 0, z),
        searchStep: 0,
        searchPauseUntil: 0,
        searchEndsAt: 0,
        alive: !reinforcement,
        pendingReinforcement: reinforcement,
        elite,
        boss,
        bossReward: bossProfile ? { ...bossProfile.reward } : null,
        name: trainingTarget
          ? `${trainingDistance} 米 · ${trainingArmorLevel} 级护甲靶`
          : bossProfile?.name ?? `${elite ? '精英' : ''}${roleConfig.label}`,
        maxHealth,
        armorDurability: armorMaxDurability,
        armorMaxDurability,
        armorBroken: false,
        floorY: 0,
        enraged: false,
        lastHitAt: performance.now() / 1000,
        walkPhase: random.next() * Math.PI * 2,
        movementBlend: 0,
        lastAnimationPosition: new THREE.Vector3(x, 0, z),
        alertLight,
        muzzleLight,
        trainingTarget,
        trainingDistance,
        trainingArmorLevel,
        trainingResetAt: 0,
      };
      if (trainingTarget) {
        runtime.facing.set(this.activeOperation.spawn.x - x, 0, this.activeOperation.spawn.z - z).normalize();
        group.rotation.y = Math.atan2(runtime.facing.x, runtime.facing.z);
      }
      body.userData.enemy = runtime;
      body.userData.hitZone = 'body';
      pelvis.userData.enemy = runtime;
      pelvis.userData.hitZone = 'body';
      armor.userData.enemy = runtime;
      armor.userData.hitZone = 'armor';
      head.userData.enemy = runtime;
      head.userData.hitZone = 'head';
      helmet.userData.enemy = runtime;
      helmet.userData.hitZone = 'head';
      visor.userData.enemy = runtime;
      visor.userData.hitZone = 'head';
      this.enemyHitMeshes.push(body, pelvis, armor, head, helmet, visor);
      this.enemies.push(runtime);
      if (!reinforcement) this.entityManager.add(vehicle);
    });
    this.refreshBossHud();
  }

  private makeEnemyWeapon(weaponId: EnemyWeaponId, vest: THREE.MeshStandardMaterial, elite: boolean): THREE.Group {
    const config = ENEMY_WEAPON_CONFIGS[weaponId];
    const group = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({
      color: weaponId === 'shotgun' ? '#5b4938' : weaponId === 'sniper' ? '#4d5e4e' : '#202724',
      roughness: 0.58,
      metalness: elite ? 0.48 : 0.28,
    });
    const receiverLength = weaponId === 'sniper' ? 0.74 : weaponId === 'shotgun' ? 0.56 : 0.48;
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, receiverLength), metal);
    receiver.position.set(0, 0, 0.08);
    receiver.castShadow = true;
    const barrelLength = weaponId === 'sniper' ? 0.82 : weaponId === 'shotgun' ? 0.6 : 0.48;
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, barrelLength), vest);
    barrel.position.set(0, 0.015, 0.62);
    barrel.castShadow = true;
    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, barrelLength * 0.58), vest);
    handguard.position.set(0, -0.005, 0.42);
    const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.025, receiverLength + 0.2), metal);
    topRail.position.set(0, 0.075, 0.08);
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 8), metal);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.015, 0.62 + barrelLength * 0.5);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.12), vest);
    grip.position.set(0, -0.15, -0.06);
    grip.rotation.x = 0.22;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.34), vest);
    stock.position.set(0, 0.015, -0.32);
    stock.scale.set(1.05, 0.86, 1);
    const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.24, 0.16), metal);
    magazine.position.set(0, -0.16, 0.17);
    magazine.rotation.x = -0.16;
    const opticBody = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.085, 0.18), metal);
    opticBody.position.set(0, 0.14, 0.03);
    const opticGlass = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.055, 0.012),
      new THREE.MeshStandardMaterial({ color: '#274b43', emissive: '#10231f', emissiveIntensity: 0.45, roughness: 0.1, metalness: 0.48 }),
    );
    opticGlass.position.set(0, 0.14, 0.127);
    group.add(receiver, barrel, handguard, topRail, muzzle, grip, stock, magazine, opticBody, opticGlass);
    if (weaponId === 'sniper') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.36, 10), metal);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.1, 0.08);
      scope.castShadow = true;
      group.add(scope);
    }
    group.position.set(0.06, 1.18, 0.22);
    group.rotation.set(-0.13, 0.16, -0.025);
    group.userData.muzzleZ = 0.62 + barrelLength * 0.5;
    group.userData.weaponLabel = config.label;
    return group;
  }

  private refreshBossHud(preferred?: EnemyRuntime): void {
    const aliveBosses = this.enemies.filter((enemy) => enemy.boss && enemy.alive);
    if (aliveBosses.length === 0) {
      this.focusedBoss = null;
      this.callbacks.onBossUpdate(null);
      return;
    }
    if (preferred?.boss && preferred.alive) this.focusedBoss = preferred;
    if (!this.focusedBoss?.alive) this.focusedBoss = aliveBosses[0];
    const boss = this.focusedBoss;
    this.callbacks.onBossUpdate({
      name: `${boss.name} · 剩余 ${aliveBosses.length} 名`,
      health: Math.max(0, boss.health),
      maxHealth: boss.maxHealth,
      enraged: boss.enraged,
    });
  }

  private animate = (frameTime = 0): void => {
    if (this.disposed || this.animationFaulted) return;
    this.animationFrameId = requestAnimationFrame(this.animate);
    try {
      this.renderFrame(frameTime);
    } catch (error) {
      this.animationFaulted = true;
      cancelAnimationFrame(this.animationFrameId);
      this.releaseHeldInputs();
      this.controlsActive = false;
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      this.callbacks.onControlCapture(false);
      this.callbacks.onFatalError(error);
    }
  };

  private renderFrame(frameTime: number): void {
    // Releasing pointer lock for the loot screen can make embedded browsers report
    // that the document lost focus. Keep the reveal timer alive while the panel is open.
    const pageIsActive = document.visibilityState === 'visible'
      && (document.hasFocus() || document.pointerLockElement === this.canvas || this.lootSearch !== null || this.debugPreviewActive);
    if (!pageIsActive) {
      this.clock.getDelta();
      return;
    }
    if (this.webGlContextLost || this.webGlSuspendedInBackground) {
      this.clock.getDelta();
      return;
    }
    if (frameTime > 0 && frameTime - this.lastRenderedAt < MIN_FRAME_INTERVAL_MS) return;
    this.lastRenderedAt = frameTime;
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
    if (['deploying', 'active', 'extracting'].includes(this.run.phase)) {
      this.updateEnemyAnimations(delta, now);
    }
    this.updateWeaponVisual(delta, now);
    this.updateWeaponEffects(delta, now);
    const extractionPulse = 0.5 + Math.sin(now * 3.2) * 0.16;
    this.extractionMarker.material.opacity = extractionPulse;
    this.extractionBeam.material.opacity = 0.13 + Math.sin(now * 2.1) * 0.045;
    this.extractionRing.rotation.z = now * 0.42;
    this.extractionRing.scale.setScalar(1 + Math.sin(now * 3.2) * 0.035);
    this.extractionLabel.position.y = 7.2 + Math.sin(now * 1.8) * 0.16;
    this.updateExtractionEffects(now);
    this.water.position.y = -1.16 + Math.sin(now * 0.8) * 0.025;
    this.updateStaticLights(delta);
    this.updateAdaptiveQuality(delta);
    this.renderer.render(this.scene, this.camera);
  }

  private updateStaticLights(delta: number): void {
    this.lightCullingAccumulator += delta;
    if (this.lightCullingAccumulator < 0.18) return;
    this.lightCullingAccumulator = 0;
    this.updateAdministrationShadowFocus();
    for (const light of this.staticPointLights) {
      light.getWorldPosition(this.lightWorldPosition);
      light.visible = !light.userData.broken
        && !this.isOperationEventActive('power-outage')
        && this.qualityLevel !== 'low'
        && (light.userData.mapId ?? 'reservoir') === this.activeOperation.id
        && this.lightWorldPosition.distanceToSquared(this.camera.position) <= this.qualityLightDistance ** 2;
    }
  }

  private updateExtractionEffects(now: number): void {
    const available = this.run.hasObjective;
    const pulse = 0.72 + Math.sin(now * 4.4) * 0.28;
    this.extractionBeacon.scale.setScalar(1 + pulse * 0.035);
    this.extractionLight.intensity = available ? 10 + pulse * 7 : 4 + pulse * 3;
    this.extractionBeam.material.opacity = available ? 0.2 + pulse * 0.055 : 0.1 + pulse * 0.025;
    this.extractionSmoke.material.opacity = available ? 0.3 : 0.15;
    const positions = this.extractionSmoke.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index += 1) {
      const phase = now * 0.34 + index * 0.61;
      const radius = 0.45 + (index % 4) * 0.22;
      positions.setXYZ(
        index,
        Math.sin(phase * 1.7) * radius,
        (phase * 1.8) % 13,
        Math.cos(phase * 1.3) * radius,
      );
    }
    positions.needsUpdate = true;
    if (available && now >= this.nextExtractionSignalAt) {
      this.audio.extractionSignal(this.extractionMarker.position);
      this.nextExtractionSignalAt = now + 3.4;
    }
  }

  private updateAdaptiveQuality(delta: number): void {
    this.performanceAccumulator += delta;
    this.performanceFrames += 1;
    if (this.performanceAccumulator < 1.5) return;
    const fps = this.performanceFrames / this.performanceAccumulator;
    const deviceScale = window.devicePixelRatio || 1;
    let nextScale = this.renderScale;
    if (fps < 36) nextScale = Math.max(this.qualityMinScale, this.renderScale - 0.2);
    else if (fps < 52) nextScale = Math.max(this.qualityMinScale, this.renderScale - 0.1);
    else if (fps > 59) nextScale = Math.min(Math.min(deviceScale, this.qualityMaxScale), this.renderScale + 0.025);
    if (Math.abs(nextScale - this.renderScale) > 0.01) {
      this.renderScale = nextScale;
      this.renderer.setPixelRatio(this.renderScale);
      this.resize();
    }
    this.performanceAccumulator = 0;
    this.performanceFrames = 0;
  }

  private updateMenuCamera(delta: number): void {
    this.menuTime += delta * 0.055;
    const angle = this.menuTime + 0.68;
    this.camera.position.set(Math.cos(angle) * 48 - 4, 10.5, Math.sin(angle) * 48 + 2);
    this.camera.lookAt(-16, 3.2, -9);
  }

  private updateRun(delta: number, now: number): void {
    // Keep the action frozen behind the control-capture overlay so enemies
    // cannot defeat the player before mouse input is available.
    if (!this.controlsActive) {
      if (this.lootSearch) this.updateLootSearch(now);
      return;
    }
    this.run.elapsedSeconds += delta;
    if (this.run.elapsedSeconds >= gameModeDefinition(this.activeGameMode).timeLimit) {
      this.failRun('撤离窗口关闭');
      return;
    }
    this.updateAbilities(delta, this.run.elapsedSeconds);
    this.updateOperationSystems(delta);
    this.updatePlayer(delta);
    this.updateAdministrationSecretDoor(delta);
    this.camera.getWorldDirection(this.audioForward);
    this.audio.setListener(this.camera.position, this.audioForward);
    this.updateEnvironmentAudio(now);
    this.syncMissionObjectiveText();
    this.updateWeapon(delta, now);
    this.aiAccumulator += delta;
    if (this.aiAccumulator >= 1 / 20) {
      this.updateEnemies(this.aiAccumulator, now);
      this.aiAccumulator = 0;
    }
    this.updateHighValueTask();
    this.updateInteraction();
    this.updateLootSearch(now);
    this.updateExtraction(delta, now);
    this.completeHealing(now);
    this.updateAccumulator += delta;
    if (this.updateAccumulator >= 0.1) {
      this.updateAccumulator = 0;
      this.callbacks.onUpdate(this.run);
      this.callbacks.onCompass(this.formatHeading());
      this.callbacks.onMiniMap(this.createMiniMapView());
      this.emitAbilityView(this.run.elapsedSeconds);
      this.emitOperationStatus();
    }
  }

  private updateOperationSystems(delta: number): void {
    const previousThreatLevel = this.threatEscalation.level;
    this.threatEscalation = getThreatEscalation(this.run.elapsedSeconds);
    if (this.threatEscalation.level > previousThreatLevel && this.threatEscalation.level > this.lastThreatLevelToast) {
      this.lastThreatLevelToast = this.threatEscalation.level;
      this.callbacks.onToast(`战场升级 · ${this.threatEscalation.label}`, 'danger');
      this.audio.tone(156, 0.22, 0.045);
    }
    const riskNow = this.isHighRiskPosition(this.camera.position);
    if (!this.operationTaskRevealed && (riskNow || this.run.elapsedSeconds >= 50)) {
      this.operationTaskRevealed = true;
      this.operationTaskRevealedAt = this.run.elapsedSeconds;
      this.callbacks.onToast(`发现隐藏任务 · ${this.operationScenario.task.title}`);
      this.audio.tone(620, 0.18, 0.045);
    }
    if (this.operationTaskRevealed) {
      this.operationTaskProgress = updateTaskClock(
        this.operationScenario.task,
        this.operationTaskProgress,
        this.run.elapsedSeconds - this.operationTaskRevealedAt,
      );
    }
    if (!this.eventStarted && this.run.elapsedSeconds >= this.eventStartsAt) this.startOperationEvent();
    if (this.eventStarted && this.eventEndsAt > 0 && this.run.elapsedSeconds >= this.eventEndsAt) this.finishOperationEvent();
    if (riskNow !== this.currentRiskHigh) {
      this.currentRiskHigh = riskNow;
      this.callbacks.onToast(riskNow ? '已进入高危区 · 敌人密集，高价值物资概率提升' : '已返回普通区 · 当前威胁降低', riskNow ? 'danger' : 'info');
    }
    if (riskNow && this.isOperationEventActive('gas-leak') && this.run.elapsedSeconds >= this.nextGasDamageAt) {
      this.nextGasDamageAt = this.run.elapsedSeconds + 2.4;
      this.damagePlayer(2.5);
    }
    const lootSignalRadius = rareLootSignalRadius(this.run.backpack);
    if (lootSignalRadius > 0 && this.run.elapsedSeconds >= this.nextLootThreatPulseAt) {
      this.nextLootThreatPulseAt = this.run.elapsedSeconds + 14;
      let alerted = 0;
      for (const enemy of this.enemies) {
        if (!enemy.alive || enemy.state === 'engage' || enemy.group.position.distanceTo(this.camera.position) > lootSignalRadius) continue;
        const suspectedPosition = this.makeImperfectEnemyMemory(this.camera.position, 5);
        enemy.lastSeen.copy(suspectedPosition);
        this.setEnemyState(enemy, 'investigate', suspectedPosition);
        alerted += 1;
      }
      if (alerted > 0) this.callbacks.onToast(`高价值物资信号暴露 · ${alerted} 名敌人正在搜索`, 'danger');
    }
    if (this.operationScenario.extractionCondition.type === 'wait-helicopter'
      && this.run.phase !== 'extracting'
      && this.extractionConditionProgress.current > 0) {
      this.extractionConditionProgress = advanceExtractionCondition(
        this.operationScenario.extractionCondition,
        Math.max(0, this.extractionConditionProgress.current - delta * 0.35),
        0,
      );
    }
  }

  private startOperationEvent(): void {
    this.eventStarted = true;
    this.eventEndsAt = this.run.elapsedSeconds + this.operationScenario.event.durationSeconds;
    const event = this.operationScenario.event;
    this.callbacks.onToast(`随机事件 · ${event.title}：${event.description}`, 'danger');
    this.audio.tone(118, 0.72, 0.08);
    if (event.type === 'power-outage') {
      this.hemisphere.intensity = this.activeGameMode === 'night' ? 0.06 : 0.32;
      const reinforcements = this.spawnPowerOutageReinforcements();
      if (reinforcements > 0) {
        this.callbacks.onToast(`停电增援 · ${reinforcements} 名敌人从外围进入`, 'danger');
        const objectivePosition = new THREE.Vector3(
          this.activeOperation.objective.x,
          this.camera.position.y,
          this.activeOperation.objective.z,
        );
        this.audio.voice('停电了，增援小队进入区域！', this.camera.position.distanceTo(objectivePosition));
      }
    }
    if (event.type === 'airdrop') {
      const crate = this.loot.find((entry) => entry.operationId === this.activeOperation.id && !entry.opened);
      if (crate) {
        const random = new SeededRandom(Math.floor(performance.now()));
        this.enrichHighRiskLoot(crate.items, random);
        this.enrichHighRiskLoot(crate.items, random);
        this.callbacks.onToast(`空投已落地 · ${crate.containerName}附近出现高价值信号`, 'danger');
      }
    }
    if (event.type === 'alarm') {
      for (const enemy of this.enemies.filter((entry) => entry.alive)) {
        const suspectedPosition = this.makeImperfectEnemyMemory(this.camera.position, enemy.boss ? 2 : 4.5);
        enemy.lastSeen.copy(suspectedPosition);
        this.setEnemyState(enemy, 'investigate', suspectedPosition);
      }
    }
    if (event.type === 'boss-patrol') {
      const leader = this.enemies.find((enemy) => enemy.boss && enemy.alive) ?? this.designatedGuard;
      if (leader) {
        const suspectedPosition = this.makeImperfectEnemyMemory(this.camera.position, 3);
        leader.lastSeen.copy(suspectedPosition);
        this.setEnemyState(leader, 'investigate', suspectedPosition);
      }
    }
  }

  private finishOperationEvent(): void {
    const event = this.operationScenario.event;
    this.eventEndsAt = 0;
    if (event.type === 'power-outage') this.hemisphere.intensity = this.activeGameMode === 'night' ? 0.22 : 1.65;
    this.callbacks.onToast(`事件结束 · ${event.title}`);
  }

  private spawnPowerOutageReinforcements(): number {
    const targetCount = this.activeDifficulty === 'recruit' ? 2 : this.activeDifficulty === 'standard' ? 3 : 4;
    const pending = this.enemies.filter((enemy) => enemy.pendingReinforcement);
    const selected: THREE.Vector3[] = [];
    let spawned = 0;
    for (const enemy of pending.slice(0, targetCount)) {
      const spawn = this.findReinforcementSpawnPoint(selected);
      selected.push(spawn);
      enemy.pendingReinforcement = false;
      enemy.alive = true;
      enemy.factionTarget = null;
      enemy.factionFireCooldown = 0.7 + Math.random() * 0.8;
      enemy.group.visible = true;
      enemy.group.position.copy(spawn);
      enemy.floorY = 0;
      enemy.home.copy(spawn);
      enemy.lastSeen.copy(this.makeImperfectEnemyMemory(this.camera.position, 5));
      enemy.perception = { awareness: 0, lastVisualAt: -100 };
      enemy.health = enemy.maxHealth;
      enemy.armorDurability = enemy.armorMaxDurability;
      enemy.armorBroken = false;
      enemy.armor.visible = true;
      enemy.fireCooldown = 0.75 + Math.random() * 0.8;
      enemy.burstRemaining = 0;
      enemy.reloading = false;
      enemy.vehicle.position.set(spawn.x, 0, spawn.z);
      enemy.vehicle.velocity.set(0, 0, 0);
      const path = new YUKA.Path();
      path.loop = true;
      path.add(new YUKA.Vector3(spawn.x, 0, spawn.z));
      path.add(new YUKA.Vector3(spawn.x + (Math.random() - 0.5) * 10, 0, spawn.z + (Math.random() - 0.5) * 10));
      path.add(new YUKA.Vector3(spawn.x + (Math.random() - 0.5) * 10, 0, spawn.z + (Math.random() - 0.5) * 10));
      enemy.path = path;
      this.entityManager.add(enemy.vehicle);
      this.setEnemyState(enemy, 'investigate', enemy.lastSeen);
      spawned += 1;
    }
    return spawned;
  }

  private findReinforcementSpawnPoint(selected: THREE.Vector3[]): THREE.Vector3 {
    const bases = this.activeOperation.enemies
      .filter((entry) => !entry[2])
      .map(([x, z]) => new THREE.Vector3(x, 0, z));
    const candidates: THREE.Vector3[] = [];
    for (const base of bases) {
      for (const radius of [0, 5, 9]) {
        for (let index = 0; index < 8; index += 1) {
          const angle = index * Math.PI / 4 + base.x * 0.03;
          const candidate = base.clone().add(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
          const safe = this.findNearbyClearPosition(candidate.x, candidate.z);
          candidate.x = safe.x;
          candidate.z = safe.z;
          if (candidate.distanceTo(this.camera.position) < 30) continue;
          if (selected.some((point) => point.distanceTo(candidate) < 5)) continue;
          if (this.enemies.some((enemy) => enemy.alive && enemy.group.position.distanceTo(candidate) < 5)) continue;
          candidates.push(candidate);
        }
      }
    }
    const scored = candidates.map((candidate) => {
      const eye = candidate.clone().add(new THREE.Vector3(0, 1.65, 0));
      const visible = this.hasLineOfSight(eye, this.camera.position);
      return { candidate, score: candidate.distanceTo(this.camera.position) + (visible ? -36 : 36) };
    });
    scored.sort((left, right) => right.score - left.score);
    if (scored[0]) return scored[0].candidate;
    return new THREE.Vector3(this.activeOperation.spawn.x, 0, this.activeOperation.spawn.z);
  }

  private isOperationEventActive(type?: OperationScenario['event']['type']): boolean {
    const active = this.eventStarted && this.eventEndsAt > this.run.elapsedSeconds;
    return active && (!type || this.operationScenario.event.type === type);
  }

  private advanceOperationTask(amount = 1): void {
    if (!this.operationTaskRevealed) return;
    const previous = this.operationTaskProgress;
    this.operationTaskProgress = advanceTaskProgress(
      this.operationScenario.task,
      previous,
      amount,
      this.run.elapsedSeconds - this.operationTaskRevealedAt,
    );
    if (!previous.completed && this.operationTaskProgress.completed && !this.operationTaskRewardGranted) {
      this.operationTaskRewardGranted = true;
      const reward = {
        id: `task-reward-${this.operationScenario.task.type}`,
        name: `${this.operationScenario.task.title}奖励凭证`,
        kind: 'intel' as const,
        rarity: 'gold' as const,
        value: this.operationScenario.task.rewardCredits,
        quantity: 1,
        description: '完成局内额外任务获得，可带出后出售。',
      };
      this.run.backpack = addInventoryItem(this.run.backpack, reward, Number.POSITIVE_INFINITY).items;
      this.callbacks.onToast(`额外任务完成 · 获得 ${reward.name}`);
    }
  }

  private emitOperationStatus(): void {
    if (!this.callbacks.onOperationStatus || !this.operationScenario) return;
    const challenge = this.challengeProgress[0];
    const definition = this.challengeDefinitions[0];
    this.callbacks.onOperationStatus({
      event: {
        title: this.operationScenario.event.title,
        description: this.eventStarted ? this.operationScenario.event.description : `预计 ${Math.max(0, Math.ceil(this.eventStartsAt - this.run.elapsedSeconds))} 秒后出现战场变化`,
        active: this.isOperationEventActive(),
        remainingSeconds: this.isOperationEventActive() ? Math.max(0, Math.ceil(this.eventEndsAt - this.run.elapsedSeconds)) : 0,
      },
      task: {
        title: this.operationTaskRevealed ? this.operationScenario.task.title : '未发现的额外任务',
        target: this.operationTaskRevealed ? this.operationScenario.task.targetText : '探索核心区域以发现任务情报',
        progress: this.operationTaskRevealed ? this.operationTaskProgress.current : 0,
        required: this.operationTaskRevealed ? this.operationTaskProgress.required : 1,
        completed: this.operationTaskRevealed && this.operationTaskProgress.completed,
        failed: this.operationTaskRevealed && this.operationTaskProgress.failed,
      },
      extraction: {
        title: this.operationScenario.extractionCondition.title,
        target: this.operationScenario.extractionCondition.targetText,
        completed: this.extractionConditionProgress.completed,
      },
      risk: { label: this.currentRiskHigh ? '高危区' : '普通区', high: this.currentRiskHigh },
      threat: {
        label: this.threatEscalation.label,
        level: this.threatEscalation.level,
        progress: this.threatEscalation.progress,
      },
      challenge: {
        title: definition.name,
        description: definition.description,
        progress: challenge.progress,
        target: challenge.target,
        completed: challenge.completed,
        failed: challenge.failed,
      },
    });
  }

  private updateEnvironmentAudio(now: number): void {
    const underground = this.activeOperation.id === 'reservoir' && this.camera.position.y < -0.65;
    if (now >= this.nextAmbientAt) {
      const side = Math.random() > 0.5 ? 1 : -1;
      const ambiencePosition = this.camera.position.clone().add(new THREE.Vector3(16 * side, underground ? 0 : 4, -20));
      this.audio.environmentPulse(ambiencePosition, underground);
      this.nextAmbientAt = now + (underground ? 3.2 : 4.8) + Math.random() * 2.6;
    }
    if (!underground && now >= this.nextDistantShotAt) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 65 + Math.random() * 70;
      const shotPosition = this.camera.position.clone().add(new THREE.Vector3(
        Math.cos(angle) * distance,
        2 + Math.random() * 5,
        Math.sin(angle) * distance,
      ));
      this.audio.distantShot(shotPosition);
      this.nextDistantShotAt = now + 8 + Math.random() * 14;
    }
    if (underground && now >= this.nextPipeEchoAt) {
      const echoPosition = this.camera.position.clone().add(new THREE.Vector3(Math.random() > 0.5 ? 24 : -24, 0, (Math.random() - 0.5) * 10));
      this.audio.pipeEcho(echoPosition);
      this.nextPipeEchoAt = now + 5 + Math.random() * 7;
    }
    if (event.type === 'enemy-convoy') {
      const reinforcements = this.spawnPowerOutageReinforcements();
      this.callbacks.onToast(
        reinforcements > 0
          ? `敌方车队抵达 · ${reinforcements} 名增援正在向核心区推进`
          : '敌方车队抵达 · 现有巡逻队开始收缩包围',
        'danger',
      );
      for (const enemy of this.enemies.filter((entry) => entry.alive && entry.state !== 'engage')) {
        const objective = new THREE.Vector3(this.activeOperation.objective.x, enemy.floorY, this.activeOperation.objective.z);
        this.setEnemyState(enemy, 'investigate', objective);
      }
    }
    if (event.type === 'gas-leak') {
      this.nextGasDamageAt = this.run.elapsedSeconds + 1.2;
      this.callbacks.onToast('毒气正在核心区域扩散 · 立即离开黄色高危范围', 'danger');
    }
  }

  private createMiniMapView(): TacticalMapView {
    const points: Array<{ x: number; z: number }> = [
      this.activeOperation.spawn,
      this.activeOperation.objective,
      this.activeOperation.extraction,
      ...this.activeOperation.enemies.map(([x, z]) => ({ x, z })),
      ...this.activeOperation.loot.map(([x, z]) => ({ x, z })),
    ];
    const margin = this.activeOperation.id === 'reservoir' ? 14 : 8;
    const minX = Math.min(...points.map((point) => point.x)) - margin;
    const maxX = Math.max(...points.map((point) => point.x)) + margin;
    const minZ = Math.min(...points.map((point) => point.z)) - margin;
    const maxZ = Math.max(...points.map((point) => point.z)) + margin;
    const player = this.playerBody.translation();
    const nearbyEnemies = this.enemies
      .filter((enemy) => {
        if (!enemy.alive) return false;
        if (this.highValueTaskStage === 'clear') return true;
        const distance = Math.hypot(enemy.group.position.x - player.x, enemy.group.position.z - player.z);
        return distance <= (enemy.boss ? 58 : enemy.state === 'engage' ? 42 : 28);
      })
      .map((enemy) => ({
        x: enemy.group.position.x,
        z: enemy.group.position.z,
        elite: enemy.elite,
        boss: enemy.boss,
    }));
    const mapId = this.activeOperation.id;
    const aliveBosses = this.enemies.filter((enemy) => enemy.boss && enemy.alive);
    const boss = aliveBosses[0];
    const bossTargetCount = this.activeBossMode === 'single' ? 1 : 2;
    const objectiveLabel: Record<MapId, string> = {
      harbor: '加密硬盘',
      radar: '频谱记录器',
      refinery: '反应堆密钥',
      administration: '中央档案',
      reservoir: '主控芯片',
    };
    const checkpoint = mapId === 'reservoir'
      ? { x: RESERVOIR_TERMINAL.x, z: RESERVOIR_TERMINAL.z, active: !this.reservoirTerminalActivated }
      : null;
    const highValueConfig = HIGH_VALUE_TASKS[mapId];
    const bonusTarget = highValueConfig && this.highValueTaskStage === 'collect'
      ? { x: highValueConfig.drive.x, z: highValueConfig.drive.z, label: highValueConfig.driveLabel }
      : highValueConfig && this.highValueTaskStage === 'deliver'
        ? { x: highValueConfig.radio.x, z: highValueConfig.radio.z, label: '交付电台' }
        : null;
    const extractionKnown = this.activeGameMode !== 'random-extract' || this.extractionIntelUnlocked;
    const target: TacticalMapView['target'] = this.isCoreMissionReady() && extractionKnown
      ? { ...this.activeOperation.extraction, label: '撤离点', type: 'extract' }
      : this.activeGameMode === 'clear'
        ? boss
          ? { x: boss.group.position.x, z: boss.group.position.z, label: boss.name, type: 'boss' }
          : { ...this.activeOperation.objective, label: '清剿热区', type: 'task' }
        : this.activeGameMode === 'survival'
          ? { x: this.activeOperation.spawn.x, z: this.activeOperation.spawn.z, label: '坚守区域', type: 'task' }
        : this.activeGameMode === 'intel'
          ? { ...this.activeOperation.objective, label: '搜集情报', type: 'task' }
          : this.activeGameMode === 'boss-hunt' && boss
            ? { x: boss.group.position.x, z: boss.group.position.z, label: boss.name, type: 'boss' }
      : mapId === 'administration' && !this.administrationEntered
        ? { x: 165, z: 35, label: '行政主楼', type: 'task' }
        : mapId === 'reservoir' && !this.reservoirTunnelEntered
          ? { x: 260, z: 82, label: '管道入口', type: 'task' }
          : mapId === 'reservoir' && !this.reservoirTerminalActivated
            ? { x: RESERVOIR_TERMINAL.x, z: RESERVOIR_TERMINAL.z, label: '检修终端', type: 'task' }
            : boss
              ? { x: boss.group.position.x, z: boss.group.position.z, label: boss.name, type: 'boss' }
              : { ...this.activeOperation.objective, label: objectiveLabel[mapId], type: 'task' };
    const extracted = this.run.phase === 'success';
    const primaryTasks: MissionTaskView[] = this.activeGameMode === 'clear'
      ? [
          { id: 'clear', label: `清除热区全部敌人（剩余 ${this.enemies.filter((enemy) => enemy.alive).length}）`, status: this.isExtractionReady() ? 'complete' : 'active' },
          { id: 'extract', label: '进入撤离区等待信号', status: extracted ? 'complete' : this.isExtractionReady() ? 'active' : 'locked' },
        ]
      : this.activeGameMode === 'survival'
        ? [
            { id: 'survive', label: `坚守 120 秒（剩余 ${Math.max(0, Math.ceil(this.survivalDurationSeconds - this.run.elapsedSeconds))} 秒）`, status: this.isExtractionReady() ? 'complete' : 'active' },
            { id: 'extract', label: '计时结束后进入撤离区', status: extracted ? 'complete' : this.isExtractionReady() ? 'active' : 'locked' },
          ]
        : this.activeGameMode === 'intel'
          ? [
              { id: 'intel', label: `搜集情报物资（${Math.min(3, this.getIntelCount())} / 3）`, status: this.isExtractionReady() ? 'complete' : 'active' },
            { id: 'extract', label: '情报齐全后进入撤离区', status: extracted ? 'complete' : this.isExtractionReady() ? 'active' : 'locked' },
          ]
          : this.activeGameMode === 'boss-hunt'
            ? [
                { id: 'hunt', label: `追踪并击败移动首领（剩余 ${aliveBosses.length}）`, status: aliveBosses.length > 0 ? 'active' : 'complete' },
                { id: 'extract', label: '回收专属红色物品并撤离', status: extracted ? 'complete' : aliveBosses.length === 0 ? 'active' : 'locked' },
              ]
            : this.activeGameMode === 'random-extract'
              ? [
                  { id: 'objective', label: this.activeOperation.objectiveText, status: this.run.hasObjective ? 'complete' : 'active' },
                  { id: 'intel', label: '寻找撤离频段地图', status: this.extractionIntelUnlocked ? 'complete' : this.run.hasObjective ? 'active' : 'locked' },
                  { id: 'extract', label: '前往已解锁撤离点', status: extracted ? 'complete' : this.isCoreMissionReady() ? 'active' : 'locked' },
                ]
              : this.activeGameMode === 'escort'
                ? [
                    { id: 'cargo', label: '取得高价值货箱', status: this.carriedObjective ? 'complete' : 'active' },
                    { id: 'extract', label: '手持货箱抵达撤离区', status: extracted ? 'complete' : this.carriedObjective ? 'active' : 'locked' },
                  ]
          : mapId === 'administration'
      ? [
          { id: 'enter', label: '进入行政主楼', status: this.administrationEntered ? 'complete' : 'active' },
          { id: 'boss', label: `击败区域首领（剩余 ${aliveBosses.length} / ${bossTargetCount}）`, status: boss ? (this.administrationEntered ? 'active' : 'locked') : 'complete' },
          { id: 'objective', label: '取得中央档案', status: this.run.hasObjective ? 'complete' : boss ? 'locked' : 'active' },
          { id: 'extract', label: '在东侧撤离区等待信号', status: extracted ? 'complete' : this.run.hasObjective ? 'active' : 'locked' },
        ]
      : mapId === 'reservoir'
        ? [
            { id: 'tunnel', label: '进入地下检修管道', status: this.reservoirTunnelEntered ? 'complete' : 'active' },
            { id: 'terminal', label: '启动地下检修终端', status: this.reservoirTerminalActivated ? 'complete' : this.reservoirTunnelEntered ? 'active' : 'locked' },
            { id: 'boss', label: `击败区域首领（剩余 ${aliveBosses.length} / ${bossTargetCount}）`, status: boss ? (this.reservoirTerminalActivated ? 'active' : 'locked') : 'complete' },
            { id: 'objective', label: '取得地下主控芯片', status: this.run.hasObjective ? 'complete' : this.reservoirTerminalActivated && !boss ? 'active' : 'locked' },
            { id: 'extract', label: '在北部撤离区等待信号', status: extracted ? 'complete' : this.run.hasObjective ? 'active' : 'locked' },
          ]
        : [
            { id: 'boss', label: `击败区域首领（剩余 ${aliveBosses.length} / ${bossTargetCount}）`, status: boss ? 'active' : 'complete' },
            { id: 'objective', label: this.activeOperation.objectiveText, status: this.run.hasObjective ? 'complete' : boss ? 'locked' : 'active' },
            { id: 'extract', label: '在撤离区等待信号', status: extracted ? 'complete' : this.run.hasObjective ? 'active' : 'locked' },
          ];
    return {
      mapId,
      mapName: this.activeOperation.name,
      bounds: mapId === 'administration' || mapId === 'reservoir'
        ? TACTICAL_MAP_BOUNDS[mapId]
        : { minX, maxX, minZ, maxZ },
      player: { x: player.x, z: player.z, yaw: this.yaw },
      objective: {
        ...this.activeOperation.objective,
        active: isObjectiveCarryMode(this.activeGameMode)
          && !this.run.hasObjective
          && !boss
          && (mapId === 'administration' ? this.administrationEntered : mapId === 'reservoir' ? this.reservoirTerminalActivated : true),
      },
      extraction: {
        ...this.activeOperation.extraction,
        active: this.isExtractionReady(),
        revealed: this.activeGameMode !== 'random-extract' || this.extractionIntelUnlocked,
      },
      checkpoint,
      target,
      bonusTarget,
      enemies: nearbyEnemies,
      tasks: primaryTasks,
      floorLabel: mapId === 'administration'
        ? (player.y >= ADMIN_UPPER_FLOOR_Y + 0.35 ? '2F' : '1F')
        : undefined,
      secretRoom: mapId === 'administration'
        ? {
            x: ADMIN_SECRET_ROOM.x,
            z: ADMIN_SECRET_ROOM.z,
            label: '秘密档案室',
            floor: '2F',
            unlocked: this.administrationSecretUnlocked,
          }
        : null,
      riskZones: [{
        x: this.activeOperation.objective.x,
        z: this.activeOperation.objective.z,
        radius: this.operationScenario.risk === 'high-risk' ? 78 : 52,
        level: 'high',
      }],
      highValueTask: this.createHighValueTaskView(),
    };
  }

  private createHighValueTaskView(): HighValueTaskView | null {
    const config = HIGH_VALUE_TASKS[this.activeOperation.id];
    if (!config || this.highValueTaskStage === 'inactive') return null;
    const aliveCount = this.enemies.filter((enemy) => enemy.alive).length;
    const activeEnemy = this.enemies.find((enemy) => enemy.alive);
    const target = this.highValueTaskStage === 'clear'
      ? {
          x: activeEnemy?.group.position.x ?? config.drive.x,
          z: activeEnemy?.group.position.z ?? config.drive.z,
          label: `敌人剩余 ${aliveCount}`,
        }
      : this.highValueTaskStage === 'collect'
        ? { x: config.drive.x, z: config.drive.z, label: config.driveLabel }
        : this.highValueTaskStage === 'deliver'
          ? { x: config.radio.x, z: config.radio.z, label: '军用电台' }
          : null;
    return {
      title: config.title,
      stage: this.highValueTaskStage,
      target,
      reward: { name: HIGH_VALUE_TASK_REWARD.name, value: HIGH_VALUE_TASK_REWARD.value },
      steps: [
        {
          id: 'high-clear',
          label: `清除区域全部敌人${this.highValueTaskStage === 'clear' ? `（剩余 ${aliveCount}）` : ''}`,
          status: this.highValueTaskStage === 'clear' ? 'active' : 'complete',
        },
        {
          id: 'high-drive',
          label: `拾取${config.driveLabel}`,
          status: this.highValueTaskStage === 'clear' ? 'locked' : this.highValueTaskStage === 'collect' ? 'active' : 'complete',
        },
        {
          id: 'high-radio',
          label: '将硬盘交给军用电台',
          status: this.highValueTaskStage === 'deliver' ? 'active' : this.highValueTaskStage === 'complete' ? 'complete' : 'locked',
        },
      ],
    };
  }

  private getIntelCount(): number {
    return this.run.backpack.reduce((total, item) => total + (item.kind === 'intel' ? item.quantity : 0), 0);
  }

  private isCoreMissionReady(): boolean {
    if (this.activeGameMode === 'training') return true;
    if (this.activeGameMode === 'extraction') return this.run.hasObjective;
    if (this.activeGameMode === 'clear') return this.enemies.every((enemy) => !enemy.alive);
    if (this.activeGameMode === 'survival') return this.run.elapsedSeconds >= this.survivalDurationSeconds;
    if (this.activeGameMode === 'intel') return this.getIntelCount() >= 3;
    if (this.activeGameMode === 'boss-hunt') return this.enemies.filter((enemy) => enemy.boss).every((enemy) => !enemy.alive);
    if (this.activeGameMode === 'random-extract') return this.run.hasObjective && this.extractionIntelUnlocked;
    return this.run.hasObjective;
  }

  private isExtractionReady(): boolean {
    if (!this.isCoreMissionReady() || this.isOperationEventActive('extraction-closure')) return false;
    return this.operationScenario.extractionCondition.type === 'wait-helicopter'
      || this.extractionConditionProgress.completed;
  }

  private modeLockedMessage(): string {
    if (this.isOperationEventActive('extraction-closure')) return '撤离点临时关闭，等待信号恢复';
    if (this.isCoreMissionReady() && !this.extractionConditionProgress.completed) {
      const condition = this.operationScenario.extractionCondition.type;
      if (condition === 'pay-credits') return '靠近撤离信标并按 E 支付 800 金币';
      if (condition === 'restore-power') return '靠近撤离信标并按 E 启动备用电源';
      if (condition === 'defeat-guard') return '先击败撤离点守卫';
    }
    if (this.activeGameMode === 'clear') return '热区仍有敌人，先清除全部威胁';
    if (this.activeGameMode === 'survival') return `还需坚守 ${Math.max(0, Math.ceil(this.survivalDurationSeconds - this.run.elapsedSeconds))} 秒`;
    if (this.activeGameMode === 'intel') return `还需搜集 ${Math.max(0, 3 - this.getIntelCount())} 件情报物资`;
    if (this.activeGameMode === 'boss-hunt') return '首领仍在区域内移动，先完成追猎';
    if (this.activeGameMode === 'random-extract' && !this.extractionIntelUnlocked) return '撤离坐标未知，先搜索地图情报';
    return '需要任务物品才能撤离';
  }

  private updatePlayer(delta: number, now = performance.now() / 1000): void {
    const adrenalineActive = this.run.elapsedSeconds < this.adrenalineEndsAt;
    const runActive = this.run.elapsedSeconds < this.runEndsAt;
    const crouching = this.isActionDown('crouch');
    const sprinting = this.isActionDown('sprint') && !crouching && this.run.player.stamina > 1;
    const forwardAmount = Number(this.isActionDown('forward')) - Number(this.isActionDown('backward'));
    const rightAmount = Number(this.isActionDown('right')) - Number(this.isActionDown('left'));
    const moving = Math.abs(forwardAmount) + Math.abs(rightAmount) > 0;
    if (sprinting && moving && this.aiming) this.setAiming(false);
    let targetSpeed = crouching ? PLAYER_CROUCH_SPEED : sprinting ? PLAYER_SPRINT_SPEED : PLAYER_WALK_SPEED;
    targetSpeed *= movementMultiplier(this.run.player.injuries);
    targetSpeed *= backpackSpeedMultiplier(this.run.backpack, this.backpackCapacity);
    if (this.aiming) targetSpeed *= 0.68;
    if (this.carriedObjective) targetSpeed *= gameModeDefinition(this.activeGameMode).movementMultiplier;
    if (adrenalineActive) targetSpeed *= ADRENALINE_SPEED_MULTIPLIER;
    if (runActive) targetSpeed *= RUN_SPEED_MULTIPLIER;

    const stanceBlend = 1 - Math.pow(0.00001, delta);
    this.crouchBlend = THREE.MathUtils.lerp(this.crouchBlend, crouching ? 1 : 0, stanceBlend);
    this.sprintBlend = THREE.MathUtils.lerp(this.sprintBlend, sprinting && moving ? 1 : 0, stanceBlend);
    this.currentMoveSpeed = THREE.MathUtils.lerp(this.currentMoveSpeed, targetSpeed, 1 - Math.pow(0.0002, delta));

    if (sprinting && moving) {
      const drainMultiplier = adrenalineActive ? 0.2 : 1;
      this.run.player.stamina = Math.max(0, this.run.player.stamina - delta * PLAYER_SPRINT_STAMINA_DRAIN * drainMultiplier);
    } else {
      const recoveryMultiplier = adrenalineActive ? 1.6 : 1;
      this.run.player.stamina = Math.min(100, this.run.player.stamina + delta * PLAYER_STAMINA_RECOVERY * recoveryMultiplier);
    }

    // Movement always follows the current mouse-controlled camera direction.
    const forward = this.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const movement = forward.multiplyScalar(forwardAmount).add(right.multiplyScalar(rightAmount));
    if (movement.lengthSq() > 1) movement.normalize();
    movement.multiplyScalar(this.currentMoveSpeed * delta);

    const groundedBeforeMove = this.characterController.computedGrounded();
    const fallSpeed = this.verticalVelocity;
    const grounded = groundedBeforeMove;
    if (grounded && this.verticalVelocity < 0) this.verticalVelocity = -0.5;
    if (grounded && now <= this.jumpQueuedUntil && !crouching) {
      this.verticalVelocity = 6.1;
      this.jumpQueuedUntil = 0;
    } else if (now > this.jumpQueuedUntil) {
      this.jumpQueuedUntil = 0;
    }
    this.verticalVelocity -= 18 * delta;

    this.characterController.computeColliderMovement(this.playerCollider, {
      x: movement.x,
      y: this.verticalVelocity * delta,
      z: movement.z,
    });
    let corrected = this.characterController.computedMovement();

    // Rapier normally slides automatically. At tight corners, however, two nearly
    // opposing wall normals can cancel the slide. Re-project the requested movement
    // along the contact tangents and give the capsule a tiny outward nudge.
    const desiredHorizontal = Math.hypot(movement.x, movement.z);
    const correctedHorizontal = Math.hypot(corrected.x, corrected.z);
    if (moving && desiredHorizontal > 0.0001 && correctedHorizontal < desiredHorizontal * 0.12
      && this.characterController.numComputedCollisions() > 0) {
      const slide = new THREE.Vector3(movement.x, this.verticalVelocity * delta, movement.z);
      const nudge = new THREE.Vector3();
      for (let index = 0; index < this.characterController.numComputedCollisions(); index += 1) {
        const collision = this.characterController.computedCollision(index);
        if (!collision) continue;
        const normal = collision.normal1;
        const dot = slide.x * normal.x + slide.y * normal.y + slide.z * normal.z;
        if (dot < 0) {
          slide.x -= normal.x * dot;
          slide.y -= normal.y * dot;
          slide.z -= normal.z * dot;
        }
        nudge.add(new THREE.Vector3(normal.x, 0, normal.z));
      }
      if (nudge.lengthSq() > 0.0001) {
        nudge.normalize().multiplyScalar(0.055);
        slide.x += nudge.x;
        slide.z += nudge.z;
      }
      this.characterController.computeColliderMovement(this.playerCollider, {
        x: slide.x,
        y: slide.y,
        z: slide.z,
      });
      const slipped = this.characterController.computedMovement();
      if (Math.hypot(slipped.x, slipped.z) > correctedHorizontal + 0.002) corrected = slipped;
    }
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
      this.recoverPlayerFromFall();
      this.callbacks.onToast('脚下地形异常，已回到最近安全位置', 'danger');
      return;
    }
    const groundedAfterMove = this.characterController.computedGrounded();
    const actualHorizontalStep = Math.hypot(next.x - translation.x, next.z - translation.z);
    if (groundedAfterMove && next.y > FALL_RECOVERY_Y + 1
      && (!moving || actualHorizontalStep > 0.015)) {
      this.lastSafePlayerPosition.set(next.x, next.y, next.z);
    }

    // If input is held but the capsule has not moved for a short period, it is
    // probably wedged at a corner. Try a few nearby clear points before falling
    // back to the last known safe position. This applies to all maps and tunnels.
    const horizontalDelta = Math.hypot(next.x - this.lastPlayerHorizontalPosition.x, next.z - this.lastPlayerHorizontalPosition.z);
    if (moving && groundedAfterMove && horizontalDelta < 0.006 && desiredHorizontal > 0.0001) {
      this.stuckPlayerSeconds += delta;
    } else {
      this.stuckPlayerSeconds = Math.max(0, this.stuckPlayerSeconds - delta * 2.5);
    }
    this.lastPlayerHorizontalPosition.set(next.x, next.y, next.z);
    if (this.stuckPlayerSeconds > 0.72 && now - this.lastStuckRecoveryAt > 1.2) {
      const clear = this.findNearbyClearPosition(next.x, next.z);
      const movedToClear = Math.hypot(clear.x - next.x, clear.z - next.z) > 0.12;
      if (movedToClear) {
        this.playerBody.setTranslation({ x: clear.x, y: next.y, z: clear.z }, true);
        this.playerBody.setNextKinematicTranslation({ x: clear.x, y: next.y, z: clear.z });
        this.lastSafePlayerPosition.set(clear.x, next.y, clear.z);
      } else {
        this.recoverPlayerFromFall();
      }
      this.stuckPlayerSeconds = 0;
      this.lastStuckRecoveryAt = now;
    }
    this.groundedBlend = THREE.MathUtils.lerp(this.groundedBlend, groundedAfterMove ? 1 : 0, 1 - Math.pow(0.0002, delta));
    if (!groundedBeforeMove && groundedAfterMove && fallSpeed < -2.6) {
      this.landingKick = THREE.MathUtils.clamp(Math.abs(fallSpeed) * 0.018, 0.06, 0.22);
      this.audio.landing(this.landingKick / 0.22);
    }
    this.cameraHeight = THREE.MathUtils.lerp(this.cameraHeight, THREE.MathUtils.lerp(0.62, 0.22, this.crouchBlend), 1 - Math.pow(0.001, delta));
    const gaitRate = THREE.MathUtils.lerp(8.4, 13.2, this.sprintBlend);
    const actualHorizontalSpeed = Math.hypot(corrected.x, corrected.z) / Math.max(delta, 0.001);
    const actuallyMoving = groundedAfterMove && actualHorizontalSpeed > 0.15;
    const movementTarget = actuallyMoving ? THREE.MathUtils.clamp(actualHorizontalSpeed / PLAYER_WALK_SPEED, 0.25, 1) : 0;
    this.motionBlend = THREE.MathUtils.lerp(this.motionBlend, movementTarget, 1 - Math.pow(0.0004, delta));
    if (actuallyMoving) {
      this.motionPhase += delta * gaitRate;
      const stepIndex = Math.floor(this.motionPhase / Math.PI);
      if (stepIndex > this.lastStepIndex) {
        this.lastStepIndex = stepIndex;
        this.audio.footstep(
          crouching ? 'crouch' : sprinting ? 'sprint' : 'walk',
          this.activeOperation.id === 'reservoir' && this.camera.position.y < -0.65,
        );
        // Footsteps are audible in every mode. Night operations amplify them,
        // while crouching keeps the radius small enough for stealth.
        this.lastPlayerNoiseAt = now;
        this.lastPlayerNoisePosition.copy(this.camera.position);
        const baseRadius = crouching ? 4.5 : sprinting ? 18 : 8;
        const nightMultiplier = this.activeGameMode === 'night' ? 1.25 : 1;
        this.lastPlayerNoiseRadius = baseRadius * gameModeDefinition(this.activeGameMode).hearingMultiplier * nightMultiplier;
      }
      if (sprinting && now >= this.nextBreathAt) {
        this.audio.breath(0.65 + this.sprintBlend * 0.35);
        this.nextBreathAt = now + 0.86;
      }
    } else {
      this.motionPhase = THREE.MathUtils.lerp(this.motionPhase, Math.round(this.motionPhase / Math.PI) * Math.PI, 1 - Math.pow(0.02, delta));
      this.lastStepIndex = Math.floor(this.motionPhase / Math.PI);
    }
    if (!sprinting && this.run.player.stamina < 55 && now >= this.nextBreathAt) {
      this.audio.breath(0.35 + (55 - this.run.player.stamina) / 85);
      this.nextBreathAt = now + 1.25;
    }
    this.landingKick = THREE.MathUtils.lerp(this.landingKick, 0, 1 - Math.pow(0.00008, delta));
    const bobStrength = this.motionBlend * THREE.MathUtils.lerp(0.52, 1, this.sprintBlend) * (this.aiming ? 0.32 : 1);
    const bobSide = Math.sin(this.motionPhase) * 0.012 * bobStrength;
    const bobVertical = Math.abs(Math.cos(this.motionPhase)) * 0.018 * bobStrength;
    const bobPitch = Math.sin(this.motionPhase * 2) * 0.006 * bobStrength;
    const bobRoll = Math.sin(this.motionPhase) * 0.012 * bobStrength;
    const lateralX = Math.cos(this.yaw) * bobSide;
    const lateralZ = -Math.sin(this.yaw) * bobSide;
    this.camera.position.set(next.x + lateralX, next.y + this.cameraHeight + bobVertical - this.landingKick, next.z + lateralZ);
    const recoilRecovery = resolveRecoilStep(this.activeWeaponId, 0, false).recovery;
    this.cameraRecoil *= Math.exp(-recoilRecovery * delta);
    const feel = WEAPON_FEEL_PROFILES[this.activeWeaponId];
    this.shotSway *= Math.exp(-feel.swayRecovery * delta);
    const shotAge = Math.max(0, now - this.lastShotAt);
    const injurySway = aimSwayMultiplier(this.run.player.injuries);
    const swayPitch = Math.sin(shotAge * 17) * this.shotSway * 0.45 * injurySway;
    const swayYaw = Math.sin(shotAge * 13 + 0.7) * this.shotSway * injurySway;
    const swayRoll = Math.sin(shotAge * 11 + 1.4) * this.shotSway * 0.7 * injurySway;
    this.camera.rotation.set(
      this.pitch + this.cameraRecoil + bobPitch + swayPitch,
      this.yaw + bobSide * 0.25 + swayYaw,
      bobRoll + swayRoll,
      'YXZ',
    );
  }

  private updateWeapon(_delta: number, now: number): void {
    const weapon = this.run.player.weapon;
    const config = this.getWeaponConfig(this.activeWeaponId);
    if (this.weaponAction !== 'idle' && now >= this.weaponActionEndsAt) this.weaponAction = 'idle';
    if (weapon.reloading && now >= weapon.reloadEndsAt) {
      const reloaded = completeReload(weapon, config.magazineSize);
      this.run.player.weapon = reloaded;
      this.weaponStates.set(this.activeWeaponId, reloaded);
      this.reloadStage = 0;
      this.audio.tone(510, 0.06, 0.04);
    }
    if (this.firing && this.weaponAction === 'idle' && !weapon.reloading && now >= this.nextShotAt) this.fireWeapon(now);
  }

  private fireWeapon(now: number): void {
    if (this.carriedObjective) {
      this.firing = false;
      this.callbacks.onToast('双手正在搬运货箱，无法开枪', 'danger');
      return;
    }
    if (this.lootSearch) this.cancelLootSearch('搜索被射击动作中断');
    const weapon = this.run.player.weapon;
    const config = this.getWeaponConfig(this.activeWeaponId);
    if (weapon.magazine <= 0) {
      this.nextShotAt = now + 0.2;
      this.audio.tone(120, 0.05, 0.05);
      if (!config.automatic) this.firing = false;
      return;
    }
    if (this.weaponAction !== 'idle' || weapon.reloading || this.weaponWallBlocked) {
      if (this.weaponWallBlocked) this.nextShotAt = now + 0.08;
      return;
    }
    if (this.activeGameMode !== 'training' && this.run.player.weaponDurability < 25) {
      const jamChance = 0.025 + (25 - this.run.player.weaponDurability) / 25 * 0.055;
      if (Math.random() < jamChance) {
        this.nextShotAt = now + 0.9;
        this.firing = false;
        this.audio.weaponAction('switch');
        this.callbacks.onToast('武器卡壳 · 耐久过低，返回装备库维修', 'danger');
        return;
      }
    }
    if (this.activeGameMode !== 'training') {
      weapon.magazine -= 1;
      this.run.player.weaponDurability = wearDurability(
        this.run.player.weaponDurability,
        this.run.player.maxWeaponDurability,
        0.08,
      );
    }
    this.challengeProgress = updateChallengeSet(
      this.challengeProgress,
      this.challengeDefinitions,
      { type: 'weapon-fired', weapon: this.activeWeaponId === 'smg' ? 'pistol' : 'other' },
    );
    this.nextShotAt = now + config.fireInterval;
    const shotGap = now - this.lastShotAt;
    this.recoilShotIndex = shotGap > Math.max(0.24, config.fireInterval * 2.2) ? 0 : this.recoilShotIndex + 1;
    const baseRecoil = WEAPON_CONFIGS[this.activeWeaponId].recoil;
    const recoilMultiplier = baseRecoil > 0 ? config.recoil / baseRecoil : 1;
    const recoilStep = resolveRecoilStep(this.activeWeaponId, this.recoilShotIndex, this.aiming, recoilMultiplier);
    this.lastShotAt = now;
    this.lastShotPosition.copy(this.camera.position);
    this.lastShotNoiseRadius = config.noiseRadius;
    this.cameraRecoil = Math.min(0.045, this.cameraRecoil + recoilStep.pitch * 0.48);
    this.yaw += recoilStep.yaw * 0.4 + (Math.random() - 0.5) * Math.abs(recoilStep.yaw || 0.0008) * 0.12;
    this.weaponRecoilKick = Math.min(0.28, this.weaponRecoilKick + recoilStep.weaponKick);
    this.shotSway = Math.max(this.shotSway, WEAPON_FEEL_PROFILES[this.activeWeaponId].postShotSway * RECOIL_AMPLITUDE);
    this.audio.shot(config.shotVolume, undefined, this.acousticSpaceAt(this.camera.position));
    this.muzzleFlash.visible = true;
    this.muzzleFlash.scale.setScalar((config.suppressor ? 0.52 : 0.9) + Math.random() * 0.32);
    this.muzzleFlash.rotation.z = Math.random() * Math.PI;
    this.muzzleFlashLight.intensity = config.suppressor ? 2.8 : 8.5;
    this.muzzleFlashEndsAt = now + (config.suppressor ? 0.035 : 0.062);
    this.spawnShellCasing();

    const fovRange = Math.max(1, this.settings.fieldOfView - config.aimFov);
    const aimProgress = this.aiming
      ? THREE.MathUtils.clamp((this.settings.fieldOfView - this.camera.fov) / fovRange, 0, 1)
      : 0;
    const spread = resolveAimSpread(config.hipSpread, config.aimSpread, aimProgress);
    for (let pellet = 0; pellet < config.pellets; pellet += 1) {
      const direction = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(this.camera.quaternion)
        .add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, 0))
        .normalize();
      this.raycaster.set(this.camera.position, direction);
      this.raycaster.far = config.range;
      const intersections = this.raycaster.intersectObjects([...this.blockers, ...this.enemyHitMeshes], false);
      const hit = intersections.find((entry) => {
        if (!entry.object.visible) return false;
        const enemy = entry.object.userData.enemy as EnemyRuntime | undefined;
        return !enemy || enemy.alive;
      });
      let tracerEnd = this.camera.position.clone().addScaledVector(direction, config.range);
      if (hit) {
        tracerEnd = hit.point.clone();
        const enemy = hit.object.userData.enemy as EnemyRuntime | undefined;
        const destructible = hit.object.userData.destructible as DestructibleRuntime | undefined;
        if (destructible && !destructible.destroyed) {
          this.damageDestructible(destructible, config.damage, hit.point, direction);
        } else if (enemy?.alive) {
          const zone = (hit.object.userData.hitZone ?? 'body') as EnemyHitZone;
          const totalDamage = zone === 'head' ? config.headshotDamage : config.damage;
          const pelletDamage = resolvePelletDamage(totalDamage, config.pellets, Boolean(config.damageIsPerShot));
          const damage = resolveDamageAtDistance(config.id, pelletDamage, hit.distance, config.range);
          this.damageEnemy(enemy, damage, zone, hit.point, direction, this.run.player.ammoLevel);
        } else {
          const surface = this.resolveImpactSurface(hit.object, hit.face?.materialIndex ?? 0);
          const normal = hit.face?.normal
            ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
            : direction.clone().multiplyScalar(-1);
          this.spawnSurfaceImpact(hit.point, normal, direction, surface);
          this.audio.surfaceImpact(surface, hit.point);
        }
      }
      this.suppressEnemiesAlongShot(
        this.camera.position,
        tracerEnd,
        hit?.object.userData.enemy as EnemyRuntime | undefined,
        now,
      );
      if (pellet === 0 || config.id === 'shotgun') {
        this.createTracer(this.camera.position.clone().addScaledVector(direction, 0.8), tracerEnd);
      }
    }
    if (!config.automatic) this.firing = false;
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

  private suppressEnemiesAlongShot(
    start: THREE.Vector3,
    end: THREE.Vector3,
    directlyHit: EnemyRuntime | undefined,
    now: number,
  ): void {
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy === directlyHit) continue;
      const chest = enemy.group.position.clone().add(new THREE.Vector3(0, 1.2, 0));
      const proximity = closestPointOnSegment(start, end, chest);
      if (proximity.t <= 0.02 || proximity.t >= 0.98 || proximity.distance > 1.85) continue;
      enemy.lastSuppressedAt = now;
      enemy.nextTacticAt = 0;
      enemy.burstRemaining = Math.min(enemy.burstRemaining, 1);
      if (enemy.state !== 'dead' && enemy.state !== 'engage') {
        const suspectedOrigin = this.makeImperfectEnemyMemory(start, enemy.boss ? 1.8 : 3.8);
        enemy.lastSeen.copy(suspectedOrigin);
        this.setEnemyState(enemy, 'investigate', suspectedOrigin);
      }
    }
  }

  private startReload(): void {
    const now = performance.now() / 1000;
    const weapon = this.run.player.weapon;
    const config = this.getWeaponConfig(this.activeWeaponId);
    if (this.weaponAction === 'switch' || weapon.reloading || weapon.magazine >= config.magazineSize || weapon.reserve <= 0) return;
    if (this.weaponAction === 'inspect') this.weaponAction = 'idle';
    this.firing = false;
    this.setAiming(false);
    this.reloadStyle = weapon.magazine === 0 ? 'empty' : 'tactical';
    this.activeReloadDuration = resolveReloadDuration(config.reloadDuration, this.reloadStyle);
    weapon.reloading = true;
    weapon.reloadEndsAt = now + this.activeReloadDuration;
    this.reloadStage = 1;
    this.callbacks.onToast(this.reloadStyle === 'empty' ? '空仓换弹 · 更换弹匣并上膛' : '战术换弹 · 快速更换弹匣');
    this.audio.weaponAction('reload-out');
  }

  private updateWeaponVisual(delta: number, now: number): void {
    if (!this.weapon) return;
    this.camera.getWorldDirection(this.weaponClearanceDirection);
    this.weaponClearanceRaycaster.set(this.camera.position, this.weaponClearanceDirection);
    this.weaponClearanceRaycaster.near = 0.08;
    this.weaponClearanceRaycaster.far = 1.18;
    this.weaponClearanceRaycaster.layers.disableAll();
    this.weaponClearanceRaycaster.layers.enable(0);
    this.weaponClearanceRaycaster.layers.enable(MAP_RENDER_LAYERS[this.activeOperation.id]);
    const clearanceHit = this.weaponClearanceRaycaster.intersectObjects(this.blockers, true)[0];
    const wallTarget = resolveWeaponClearance(clearanceHit?.distance ?? null);
    this.weaponWallBlocked = wallTarget > 0.08;
    this.weaponWallBlend = THREE.MathUtils.lerp(this.weaponWallBlend, wallTarget, 1 - Math.pow(0.00001, delta));
    if (this.weaponWallBlocked && this.aiming) this.setAiming(false);

    const targetX = this.aiming ? 0 : 0.27;
    const targetY = (this.aiming ? -0.12 : -0.25) - this.crouchBlend * 0.012;
    const blend = 1 - Math.pow(0.0001, delta);
    const sprinting = this.sprintBlend > 0.05;
    const bob = Math.sin(this.motionPhase) * this.motionBlend;
    const bobLift = Math.abs(Math.cos(this.motionPhase)) * this.motionBlend;
    const idleBreath = Math.sin(now * 1.65) * (this.aiming ? 0.0015 : 0.0035) * (1 - this.sprintBlend);
    const reloadDuration = this.activeReloadDuration;
    const reloadStart = this.run.player.weapon.reloadEndsAt - reloadDuration;
    const reloadProgress = this.run.player.weapon.reloading
      ? THREE.MathUtils.clamp((now - reloadStart) / reloadDuration, 0, 1)
      : 0;
    const magazineInsertPoint = this.reloadStyle === 'empty' ? 0.55 : 0.5;
    if (reloadProgress >= magazineInsertPoint && this.reloadStage < 2) {
      this.reloadStage = 2;
      this.audio.weaponAction('reload-in');
    }
    if (this.reloadStyle === 'empty' && reloadProgress >= 0.82 && this.reloadStage < 3) {
      this.reloadStage = 3;
      this.audio.weaponAction('switch');
    }
    const actionProgress = this.weaponAction === 'idle'
      ? 0
      : THREE.MathUtils.clamp((now - this.weaponActionStartedAt) / Math.max(0.01, this.weaponActionEndsAt - this.weaponActionStartedAt), 0, 1);
    const actionEnvelope = Math.sin(actionProgress * Math.PI);
    const switchEnvelope = this.weaponAction === 'switch' ? actionEnvelope : 0;
    const inspectEnvelope = this.weaponAction === 'inspect' ? actionEnvelope : 0;
    const reloadEnvelope = Math.sin(reloadProgress * Math.PI);
    const emptyChamberProgress = this.reloadStyle === 'empty'
      ? THREE.MathUtils.clamp((reloadProgress - 0.78) / 0.22, 0, 1)
      : 0;
    const emptyChamberEnvelope = Math.sin(emptyChamberProgress * Math.PI);
    const hurtProgress = THREE.MathUtils.clamp(
      (now - this.weaponHurtStartedAt) / Math.max(0.01, this.weaponHurtEndsAt - this.weaponHurtStartedAt),
      0,
      1,
    );
    const hurtEnvelope = now < this.weaponHurtEndsAt ? Math.sin(hurtProgress * Math.PI) : 0;
    let magazineDrop = 0;
    if (this.reloadStyle === 'empty') {
      if (reloadProgress >= 0.16 && reloadProgress < 0.42) magazineDrop = (reloadProgress - 0.16) / 0.26;
      else if (reloadProgress >= 0.42 && reloadProgress < 0.55) magazineDrop = 1;
      else if (reloadProgress >= 0.55 && reloadProgress < 0.76) magazineDrop = 1 - (reloadProgress - 0.55) / 0.21;
    } else {
      if (reloadProgress >= 0.2 && reloadProgress < 0.42) magazineDrop = (reloadProgress - 0.2) / 0.22;
      else if (reloadProgress >= 0.42 && reloadProgress < 0.5) magazineDrop = 1;
      else if (reloadProgress >= 0.5 && reloadProgress < 0.72) magazineDrop = 1 - (reloadProgress - 0.5) / 0.22;
    }
    const magazineTravel = this.reloadStyle === 'empty' ? 1 : 0.72;
    this.weaponMagazine.position.set(
      magazineDrop * (this.reloadStyle === 'empty' ? 0.035 : 0.12),
      -0.17 - magazineDrop * 0.46 * magazineTravel,
      -0.33 + magazineDrop * 0.08,
    );
    this.weaponMagazine.rotation.x = -0.12 + magazineDrop * (this.reloadStyle === 'empty' ? 0.28 : 0.18);
    this.weaponMagazine.rotation.z = magazineDrop * (this.reloadStyle === 'empty' ? -0.08 : -0.3);
    const movementScale = 1 - Math.max(switchEnvelope, inspectEnvelope, reloadEnvelope) * 0.85;
    const sprintPose = this.sprintBlend
      * (1 - Math.max(switchEnvelope, inspectEnvelope, reloadEnvelope) * 0.92)
      * (1 - this.weaponWallBlend * 0.72);
    const visualTargetX = THREE.MathUtils.lerp(targetX, -0.08, inspectEnvelope)
      + reloadEnvelope * 0.08 + switchEnvelope * 0.1 + sprintPose * 0.05
      + this.weaponWallBlend * 0.1 + hurtEnvelope * 0.08 * this.weaponHurtSide;
    const visualTargetY = THREE.MathUtils.lerp(targetY, -0.13, inspectEnvelope)
      - switchEnvelope * 0.58 - reloadEnvelope * 0.07 - sprintPose * 0.15
      - this.weaponWallBlend * 0.08 - hurtEnvelope * 0.09;
    const recoilRecovery = resolveRecoilStep(this.activeWeaponId, 0, false).recovery;
    this.weaponRecoilKick *= Math.exp(-recoilRecovery * 1.45 * delta);
    this.weapon.position.x = THREE.MathUtils.lerp(
      this.weapon.position.x,
      visualTargetX + bob * (sprinting ? 0.014 : 0.008) * movementScale + this.lookSwayX * (this.aiming ? 0.38 : 1) * movementScale,
      blend,
    );
    this.weapon.position.y = THREE.MathUtils.lerp(
      this.weapon.position.y,
      visualTargetY + bobLift * (sprinting ? 0.018 : 0.01) * movementScale + idleBreath * movementScale + this.lookSwayY * (this.aiming ? 0.42 : 1) * movementScale - this.landingKick * 0.3 - (1 - this.groundedBlend) * 0.025,
      blend,
    );
    this.weapon.position.z = THREE.MathUtils.lerp(
      this.weapon.position.z,
      THREE.MathUtils.lerp(-0.52, -0.4, inspectEnvelope) + sprintPose * 0.15
        + this.weaponWallBlend * 0.34 + hurtEnvelope * 0.04
        + this.weaponRecoilKick - this.landingKick * 0.18,
      blend,
    );
    const targetRotationZ = bob * 0.025 * movementScale - this.lookSwayX * 0.4 * movementScale
      - sprintPose * 0.15 - reloadEnvelope * 0.18 + inspectEnvelope * 0.13
      - switchEnvelope * 0.2 - this.weaponWallBlend * 0.24 + hurtEnvelope * 0.24 * this.weaponHurtSide;
    const targetRotationY = this.lookSwayX * 0.32 * movementScale + sprintPose * 0.12
      - reloadEnvelope * 0.3 - inspectEnvelope * 0.82 - this.weaponWallBlend * 0.36
      + emptyChamberEnvelope * 0.18;
    const targetRotationX = this.lookSwayY * 0.22 * movementScale + idleBreath * 0.8
      + reloadEnvelope * 0.62 + inspectEnvelope * 0.17 + switchEnvelope * 0.22
      - sprintPose * 0.34 + this.weaponWallBlend * 0.52
      - emptyChamberEnvelope * 0.24 + hurtEnvelope * 0.1;
    this.weapon.rotation.z = THREE.MathUtils.lerp(this.weapon.rotation.z, targetRotationZ, blend);
    this.weapon.rotation.y = THREE.MathUtils.lerp(this.weapon.rotation.y, targetRotationY, blend);
    this.weapon.rotation.x = THREE.MathUtils.lerp(this.weapon.rotation.x, targetRotationX, blend);
    this.leftPlayerArm.rotation.z = THREE.MathUtils.lerp(this.leftPlayerArm.rotation.z, -0.18 - bob * 0.12 * movementScale - reloadEnvelope * 0.72 + inspectEnvelope * 0.16, blend);
    this.leftPlayerArm.rotation.x = THREE.MathUtils.lerp(this.leftPlayerArm.rotation.x, reloadEnvelope * 0.58 - inspectEnvelope * 0.18 + emptyChamberEnvelope * 0.46, blend);
    this.rightPlayerArm.rotation.z = THREE.MathUtils.lerp(this.rightPlayerArm.rotation.z, 0.18 + bob * 0.12 * movementScale + inspectEnvelope * 0.12, blend);
    this.rightPlayerArm.rotation.x = THREE.MathUtils.lerp(this.rightPlayerArm.rotation.x, inspectEnvelope * 0.12, blend);
    this.lookSwayX = THREE.MathUtils.lerp(this.lookSwayX, 0, 1 - Math.pow(0.00001, delta));
    this.lookSwayY = THREE.MathUtils.lerp(this.lookSwayY, 0, 1 - Math.pow(0.00001, delta));
    const config = this.getWeaponConfig(this.activeWeaponId);
    const adrenalineFov = this.run.elapsedSeconds < this.adrenalineEndsAt ? 2.5 : 0;
    const fov = this.aiming ? config.aimFov : this.settings.fieldOfView + adrenalineFov;
    const aimBlend = 1 - Math.exp(-WEAPON_FEEL_PROFILES[this.activeWeaponId].aimSpeed * delta);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, aimBlend);
      this.camera.updateProjectionMatrix();
    }
  }

  private damageEnemy(
    enemy: EnemyRuntime,
    damage: number,
    hitZone: EnemyHitZone,
    hitPoint?: THREE.Vector3,
    hitDirection?: THREE.Vector3,
    ammoLevel: AmmoLevel = 1,
  ): void {
    const now = performance.now() / 1000;
    enemy.factionTarget = null;
    const previousBossPhase = enemy.boss ? getBossCombatPhase(enemy.health, enemy.maxHealth) : null;
    const zone = hitZone === 'armor' && enemy.armorBroken ? 'body' : hitZone;
    const headshot = zone === 'head';
    if (enemy.role === 'shield' && !headshot && hitDirection) {
      const reducedDamage = applyShieldDamageReduction(damage, {
        attackerDirection: hitDirection.clone().multiplyScalar(-1),
        shieldForward: enemy.facing,
      });
      if (reducedDamage < damage) {
        damage = reducedDamage;
        this.callbacks.onToast('正面攻击被盾牌挡住 · 尝试绕到侧后方', 'danger');
      }
    }
    let armorJustBroken = false;
    if (zone === 'armor') {
      const armorLevel = enemy.trainingTarget
        ? enemy.trainingArmorLevel
        : enemy.boss ? 5 : enemy.elite ? 4 : 2;
      const ballistic = resolveBallisticHit(damage, enemy.armorDurability, ammoLevel, armorLevel);
      enemy.armorDurability = ballistic.armorDurability;
      damage = ballistic.healthDamage;
      this.run.combatLog = [...this.run.combatLog.slice(-119), {
        atSeconds: this.run.elapsedSeconds,
        direction: 'dealt',
        bodyPart: 'torso',
        ammoLevel,
        armorLevel,
        rawDamage: damage,
        healthDamage: ballistic.healthDamage,
        armorDamage: ballistic.armorDamage,
        penetrated: ballistic.penetrated,
      }];
      if (enemy.armorDurability === 0 && !enemy.armorBroken) {
        enemy.armorBroken = true;
        armorJustBroken = true;
        enemy.armor.visible = false;
      }
    }
    const armorMultiplier = enemy.boss ? (headshot ? 0.82 : 0.58) : 1;
    enemy.health -= damage * armorMultiplier;
    enemy.lastHitAt = now;
    enemy.lastSuppressedAt = now;
    enemy.hurtEndsAt = now + (headshot ? 0.34 : 0.24);
    enemy.nextTacticAt = 0;
    if (enemy.boss && !enemy.enraged && enemy.health <= enemy.maxHealth * 0.5 && enemy.health > 0) {
      enemy.enraged = true;
      enemy.burstRemaining = 0;
      enemy.fireCooldown = Math.min(enemy.fireCooldown, 0.12);
      enemy.alertLight.color.set('#ff160d');
      enemy.alertLight.visible = true;
      enemy.group.scale.set(1.34, 1.22, 1.34);
      this.callbacks.onToast(`警告：${enemy.name}进入狂暴状态！`, 'danger');
      this.audio.tone(72, 0.65, 0.14);
    }
    if (enemy.boss && enemy.health > 0) this.refreshBossHud(enemy);
    this.callbacks.onHit(zone);
    if (hitPoint && zone !== 'armor') this.spawnBloodImpact(hitPoint, hitDirection ?? new THREE.Vector3(0, 0, -1), headshot);
    if (hitPoint && zone === 'armor') {
      this.spawnArmorImpact(hitPoint, hitDirection ?? new THREE.Vector3(0, 0, -1), armorJustBroken);
      if (armorJustBroken) this.audio.armorBreak(hitPoint);
    }
    this.audio.impact(zone);
    if (enemy.trainingTarget) {
      if (enemy.health <= 0) {
        enemy.alive = false;
        enemy.state = 'dead';
        enemy.deathStartedAt = now;
        enemy.trainingResetAt = now + 1.25;
        enemy.vehicle.velocity.set(0, 0, 0);
        this.callbacks.onToast(`训练靶击倒 · ${enemy.trainingDistance} 米 · ${enemy.trainingArmorLevel} 级护甲 · 1.2 秒后复位`);
      } else {
        const remaining = Math.max(0, Math.ceil(enemy.health));
        this.callbacks.onToast(`训练命中 · ${enemy.trainingDistance} 米 · ${enemy.trainingArmorLevel} 级护甲 · 剩余 ${remaining} 生命`);
      }
      return;
    }
    if (enemy.health <= 0) {
      enemy.alive = false;
      enemy.state = 'dead';
      enemy.deathStartedAt = now;
      enemy.reloading = false;
      enemy.vehicle.velocity.set(0, 0, 0);
      this.entityManager.remove(enemy.vehicle);
      enemy.body.material = new THREE.MeshStandardMaterial({ color: '#353a34', roughness: 1 });
      this.run.kills += 1;
      this.challengeProgress = updateChallengeSet(
        this.challengeProgress,
        this.challengeDefinitions,
        { type: 'kill', headshot },
      );
      if (this.operationScenario.task.type === 'hunt-target' && (enemy === this.designatedGuard || enemy.boss || enemy.role === 'captain')) {
        this.advanceOperationTask();
      }
      if (this.operationScenario.extractionCondition.type === 'defeat-guard' && enemy === this.designatedGuard) {
        this.extractionConditionProgress = advanceExtractionCondition(this.operationScenario.extractionCondition, 0, 1);
        this.callbacks.onToast('撤离守卫已清除 · 撤离通道开放');
      }
      this.spawnCorpseBackpack(enemy);
      if (enemy.boss) {
        this.refreshBossHud();
        const aliveBossCount = this.enemies.filter((entry) => entry.boss && entry.alive).length;
        this.callbacks.onToast(aliveBossCount > 0
          ? `${enemy.name}已击败 · 还剩 ${aliveBossCount} 名区域首领`
          : '两名区域首领已全部击败 · 任务物品锁定解除');
        this.audio.tone(940, 0.42, 0.1);
      } else {
        this.callbacks.onToast(headshot ? '威胁解除 · 可搜索战术背包' : '威胁解除 · 可搜索战术背包');
      }
      this.updateHighValueTask();
      this.syncMissionObjectiveText();
      this.callbacks.onMiniMap(this.createMiniMapView());
    } else {
      const enemyEye = enemy.group.position.clone().add(new THREE.Vector3(0, 1.65, 0));
      if (this.hasLineOfSight(enemyEye, this.camera.position)) {
        enemy.perception = { awareness: 1, lastVisualAt: now };
        enemy.lastSeen.copy(this.camera.position);
        this.setEnemyState(enemy, 'engage', enemy.lastSeen);
      } else {
        const suspectedOrigin = this.makeImperfectEnemyMemory(this.camera.position, enemy.boss ? 1.5 : 3.2);
        enemy.lastSeen.copy(suspectedOrigin);
        this.setEnemyState(enemy, 'investigate', suspectedOrigin);
      }
    }
  }

  private makeImperfectEnemyMemory(target: THREE.Vector3, radius: number): THREE.Vector3 {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * Math.max(0, radius);
    return target.clone().add(new THREE.Vector3(
      Math.cos(angle) * distance,
      0,
      Math.sin(angle) * distance,
    ));
  }

  private findFactionEnemyTarget(enemy: EnemyRuntime, maxDistance: number): EnemyRuntime | null {
    const sourceIndex = this.enemies.indexOf(enemy);
    if (sourceIndex < 0) return null;
    const combatants = this.enemies.map((entry, id) => ({
      id,
      faction: entry.faction,
      alive: entry.alive && !entry.pendingReinforcement,
      x: entry.group.position.x,
      z: entry.group.position.z,
    }));
    const selected = selectFactionTarget(combatants[sourceIndex], combatants, maxDistance);
    if (!selected) return null;
    const target = this.enemies[selected.id];
    const origin = enemy.group.position.clone().add(new THREE.Vector3(0, 1.55, 0));
    const targetPoint = target.group.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    return this.hasLineOfSight(origin, targetPoint) ? target : null;
  }

  private updateEnemyFactionCombat(enemy: EnemyRuntime, target: EnemyRuntime, distance: number, delta: number, now: number): void {
    const previousTarget = enemy.factionTarget;
    enemy.factionTarget = target;
    if (previousTarget !== target || enemy.state !== 'engage') {
      enemy.state = 'engage';
      enemy.lastStateChange = now;
      enemy.vehicle.steering.clear();
      enemy.vehicle.steering.add(enemy.seek);
    }
    const targetPosition = target.group.position;
    const direction = this.enemyDirectionScratch.subVectors(targetPosition, enemy.group.position).setY(0).normalize();
    enemy.facing.lerp(direction, Math.min(1, delta * 4.5)).normalize();
    this.faceEnemyDirection(enemy, enemy.facing);
    enemy.seek.target.set(targetPosition.x, 0, targetPosition.z);

    const weapon = ENEMY_WEAPON_CONFIGS[enemy.weaponId];
    const firingDistance = Math.min(weapon.range, Math.max(weapon.preferredMax, 14));
    if (distance > firingDistance * 0.86) {
      enemy.vehicle.maxSpeed = this.enemyMoveSpeed(enemy, 0.86);
    } else {
      enemy.vehicle.maxSpeed = 0;
      enemy.vehicle.velocity.set(0, 0, 0);
    }

    enemy.factionFireCooldown -= delta;
    if (enemy.reloading) return;
    if (enemy.ammo <= 0) {
      this.startEnemyReload(enemy, now);
      return;
    }
    if (distance > firingDistance || enemy.factionFireCooldown > 0) return;

    enemy.ammo -= 1;
    enemy.lastFiredAt = now;
    enemy.factionFireCooldown = weapon.fireInterval + weapon.burstPause * 0.55 + Math.random() * 0.5;
    const muzzleZ = Number(enemy.weapon.userData.muzzleZ ?? 0.9);
    const origin = enemy.weapon.localToWorld(this.enemyMuzzleScratch.set(0, 0, muzzleZ));
    const targetPoint = target.group.position.clone().add(new THREE.Vector3(0, 1.15, 0));
    this.createTracer(origin, targetPoint);
    this.audio.enemyShot(weapon.shotVolume * 0.82, origin, this.acousticSpaceAt(origin));
    const accuracy = THREE.MathUtils.clamp(weapon.baseAccuracy - distance * weapon.distanceFalloff, 0.16, 0.62);
    if (Math.random() <= accuracy) {
      const damage = weapon.damageMin + Math.random() * (weapon.damageMax - weapon.damageMin);
      this.damageEnemyFromFaction(target, enemy, damage);
    }
  }

  private damageEnemyFromFaction(target: EnemyRuntime, attacker: EnemyRuntime, damage: number): void {
    if (!target.alive) return;
    const result = resolveFactionDamage(target.health, target.armorDurability, damage, target.boss ? 0.62 : target.elite ? 0.52 : 0.42);
    target.health = result.health;
    target.armorDurability = result.armor;
    target.lastHitAt = performance.now() / 1000;
    target.lastSuppressedAt = target.lastHitAt;
    target.hurtEndsAt = target.lastHitAt + 0.24;
    if (target.armorDurability <= 0 && !target.armorBroken) {
      target.armorBroken = true;
      target.armor.visible = false;
    }
    if (target.boss && target.health > 0) this.refreshBossHud(target);
    if (!result.killed) {
      target.factionTarget = attacker;
      return;
    }

    target.alive = false;
    target.state = 'dead';
    target.factionTarget = null;
    target.deathStartedAt = target.lastHitAt;
    target.reloading = false;
    target.vehicle.velocity.set(0, 0, 0);
    this.entityManager.remove(target.vehicle);
    this.spawnCorpseBackpack(target);
    if (this.operationScenario.extractionCondition.type === 'defeat-guard' && target === this.designatedGuard) {
      this.extractionConditionProgress = advanceExtractionCondition(this.operationScenario.extractionCondition, 0, 1);
      this.callbacks.onToast('敌对势力清除了撤离守卫 · 撤离通道开放');
    }
    if (target.boss) this.refreshBossHud();
    this.callbacks.onToast(`势力交战 · ${target.name}被敌对小队击倒`);
    this.updateHighValueTask();
    this.syncMissionObjectiveText();
    this.callbacks.onMiniMap(this.createMiniMapView());
  }

  private updateEnemies(delta: number, now: number): void {
    const player = this.camera.position;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const weaponConfig = ENEMY_WEAPON_CONFIGS[enemy.weaponId];
      if (enemy.reloading && now >= enemy.reloadEndsAt) {
        enemy.reloading = false;
        enemy.ammo = weaponConfig.magazineSize;
        enemy.fireCooldown = Math.max(enemy.fireCooldown, 0.28);
        enemy.nextTacticAt = 0;
      }
      const bossTuning = enemy.boss
        ? getBossCombatTuning(enemy.health, enemy.maxHealth, this.activeDifficulty)
        : null;
      if (bossTuning
        && bossTuning.recoveryRate > 0
        && enemy.health < enemy.maxHealth * bossTuning.recoveryCeiling
        && now - enemy.lastHitAt > bossTuning.recoveryDelay) {
        enemy.health = Math.min(
          enemy.maxHealth * bossTuning.recoveryCeiling,
          enemy.health + enemy.maxHealth * bossTuning.recoveryRate * delta,
        );
        if (this.focusedBoss === enemy) this.refreshBossHud(enemy);
      }
      if (enemy.role === 'medic') {
        const ally = this.enemies
          .filter((entry) => entry !== enemy && entry.alive && entry.faction === enemy.faction && entry.health < entry.maxHealth)
          .sort((left, right) => left.group.position.distanceToSquared(enemy.group.position)
            - right.group.position.distanceToSquared(enemy.group.position))[0];
        if (ally) {
          const healing = calculateMedicHeal({
            medicAlive: enemy.alive,
            allyAlive: ally.alive,
            allyHealth: ally.health,
            allyMaxHealth: ally.maxHealth,
            distance: ally.group.position.distanceTo(enemy.group.position),
            now,
            lastHealAt: enemy.lastRoleActionAt,
          });
          if (healing.canHeal) {
            ally.health = healing.allyHealth;
            enemy.lastRoleActionAt = now;
            this.audio.tone(520, 0.12, 0.025);
            this.callbacks.onToast(`医疗兵正在救治 ${ally.name}`, 'danger');
          }
        }
      }
      const enemyEye = this.enemyEyeScratch.copy(enemy.group.position);
      enemyEye.y += 1.65;
      const toPlayer = this.enemyToPlayerScratch.subVectors(player, enemyEye);
      const distance = toPlayer.length();
      const direction = this.enemyDirectionScratch.copy(toPlayer).normalize();
      const mode = gameModeDefinition(this.activeGameMode);
      const sightRange = (enemy.boss ? 90 : Math.max(34, weaponConfig.range + 10)) * mode.visionMultiplier;
      const visible = distance < sightRange && this.hasLineOfSight(enemyEye, player);
      const inCone = enemy.facing.dot(direction) > 0.55;
      const heardShot = now - this.lastShotAt < 0.8
        && enemy.group.position.distanceTo(this.lastShotPosition) < this.lastShotNoiseRadius * mode.hearingMultiplier;
      const heardMovement = now - this.lastPlayerNoiseAt < 0.72
        && enemy.group.position.distanceTo(this.lastPlayerNoisePosition) < this.lastPlayerNoiseRadius;
      const perception = updateEnemyPerception({
        state: enemy.perception,
        now,
        delta: delta * this.threatEscalation.perceptionMultiplier,
        visible: now >= this.combatGraceEndsAt && visible,
        inCone,
        closeRange: distance < 7,
        alreadyEngaged: enemy.state === 'engage' && enemy.factionTarget === null,
        difficulty: this.activeDifficulty,
        elite: enemy.elite,
        boss: enemy.boss,
      });
      enemy.perception = perception.state;
      const confirmingTarget = perception.observing && !perception.confirmed;

      const factionTarget = !perception.confirmed && !confirmingTarget
        ? this.findFactionEnemyTarget(enemy, Math.min(42, weaponConfig.range + 8))
        : null;
      if (perception.observing) enemy.lastSeen.copy(player);
      if (perception.confirmed) {
        if (enemy.factionTarget) enemy.state = 'investigate';
        enemy.factionTarget = null;
        enemy.lastSeen.copy(player);
        this.setEnemyState(enemy, 'engage', player);
      } else if (factionTarget) {
        this.updateEnemyFactionCombat(
          enemy,
          factionTarget,
          enemy.group.position.distanceTo(factionTarget.group.position),
          delta,
          now,
        );
        continue;
      } else if (confirmingTarget) {
        enemy.factionTarget = null;
        const cautiousDirection = this.enemyDirectionScratch.copy(direction).setY(0).normalize();
        enemy.facing.lerp(cautiousDirection, Math.min(1, delta * 1.25)).normalize();
        enemy.group.lookAt(this.enemyLookTargetScratch.copy(enemy.group.position).add(enemy.facing));
        enemy.vehicle.maxSpeed = 0;
        enemy.vehicle.velocity.set(0, 0, 0);
      } else if ((heardShot || heardMovement) && enemy.state === 'patrol') {
        const noisePosition = heardShot ? this.lastShotPosition : this.lastPlayerNoisePosition;
        const suspectedOrigin = this.makeImperfectEnemyMemory(noisePosition, enemy.boss ? 1.8 : heardMovement ? 5.4 : 4.2);
        enemy.lastSeen.copy(suspectedOrigin);
        this.setEnemyState(enemy, 'investigate', suspectedOrigin);
      } else if (enemy.state === 'engage' && now - enemy.perception.lastVisualAt > 0.65) {
        this.beginEnemySearch(enemy, enemy.lastSeen, now);
      } else if (enemy.state === 'investigate' && enemy.group.position.distanceTo(enemy.lastSeen) < 1.8) {
        this.beginEnemySearch(enemy, enemy.lastSeen, now);
      } else if (enemy.state === 'search') {
        this.updateEnemySearch(enemy, now, delta);
      } else if (enemy.state === 'return' && enemy.group.position.distanceTo(enemy.home) < 2) {
        this.setEnemyState(enemy, 'patrol', enemy.home);
      }

      if (!factionTarget && enemy.factionTarget) enemy.factionTarget = null;

      if (enemy.state === 'engage') {
        const bossTuning = enemy.boss
          ? getBossCombatTuning(enemy.health, enemy.maxHealth, this.activeDifficulty)
          : null;
        const knownTarget = visible ? player : enemy.lastSeen;
        const knownDistance = enemy.group.position.distanceTo(knownTarget);
        const knownDirection = this.enemyDirectionScratch.subVectors(knownTarget, enemy.group.position).setY(0).normalize();
        enemy.alertLight.intensity = enemy.enraged
          ? 9 + Math.sin(now * 18) * 3
          : enemy.elite ? 5 + Math.sin(now * 12) * 2 : 1.8;
        enemy.alertLight.visible = enemy.elite;
        enemy.facing.lerp(knownDirection, Math.min(1, delta * (confirmingTarget ? 1.25 : 5))).normalize();
        enemy.group.lookAt(knownTarget.x, enemy.group.position.y + 1, knownTarget.z);
        if (confirmingTarget) {
          enemy.vehicle.maxSpeed = 0;
          enemy.vehicle.velocity.set(0, 0, 0);
        } else {
          this.updateEnemyTactics(enemy, knownTarget, knownDistance, visible, now);
          if (shouldAssaultAdvance({ role: enemy.role, distance: knownDistance, targetVisible: visible })) {
            enemy.tactic = 'advance';
            enemy.tacticalTarget.copy(knownTarget);
            enemy.seek.target.set(knownTarget.x, 0, knownTarget.z);
            enemy.vehicle.maxSpeed = getEnemyRoleConfig('assault').speed;
          }
          if (enemy.role === 'captain') {
            const support = getCaptainSupportResult({
              captainAlive: enemy.alive,
              now,
              lastCalledAt: enemy.lastRoleActionAt,
              cooldown: bossTuning?.supportCooldown,
              nearbyThreats: this.countNearbyAllies(enemy),
              playerVisible: visible,
            });
            if (support.canCall) {
              enemy.lastRoleActionAt = now;
              enemy.lastCallAt = -100;
              const alerted = this.alertNearbyEnemies(enemy, knownTarget, now);
              this.audio.voice('所有单位向我靠拢，封锁出口！', knownDistance);
              this.callbacks.onToast(`队长呼叫支援 · ${alerted} 名敌人正在赶来`, 'danger');
            }
          }
          if (enemy.boss && this.activeOperation.id === 'administration') {
            this.updateBossFloorTarget(enemy, knownTarget, delta);
          }
        }
        enemy.fireCooldown -= delta;
        const attackRange = enemy.boss ? Math.max(weaponConfig.range, 58) : weaponConfig.range;
        const warning = updateEnemyAttackWarning({
          state: enemy.attackWarning,
          now,
          targetVisible: visible && perception.confirmed,
          targetInRange: distance < attackRange,
          difficulty: this.activeDifficulty,
          reactionRoll: Math.random(),
          warningRoll: Math.random(),
          nearbyAllies: this.countNearbyAllies(enemy),
          elite: enemy.elite,
          boss: enemy.boss,
        });
        enemy.attackWarning = warning.state;
        if (warning.cue === 'callout') {
          const line = enemy.boss ? '目标确认，封锁退路！' : '发现目标，准备开火！';
          this.audio.voice(line, enemy.group.position.distanceTo(this.camera.position));
          this.callbacks.onToast(`${enemy.name}喊话：${line}`, 'danger');
        } else if (warning.cue === 'raise_weapon') {
          this.callbacks.onToast(`${enemy.name}正在抬枪瞄准`, 'danger');
        }
        if (warning.canFire && enemy.fireCooldown <= 0) this.enemyFire(enemy, distance, now);
      } else {
        enemy.attackWarning = { phase: 'idle', readyAt: 0 };
        enemy.alertLight.intensity = THREE.MathUtils.lerp(enemy.alertLight.intensity, 0, Math.min(1, delta * 7));
        if (enemy.alertLight.intensity < 0.08) enemy.alertLight.visible = false;
        if (!confirmingTarget && (enemy.state === 'patrol' || enemy.state === 'investigate' || enemy.state === 'return')) {
          enemy.vehicle.maxSpeed = this.enemyMoveSpeed(enemy);
        }
      }
      enemy.muzzleLight.intensity = THREE.MathUtils.lerp(enemy.muzzleLight.intensity, 0, Math.min(1, delta * 18));
      if (enemy.muzzleLight.intensity < 0.08) enemy.muzzleLight.visible = false;
    }

    this.entityManager.update(delta);
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
      const previous = this.enemyPreviousScratch.copy(enemy.group.position);
      const desired = this.enemyDesiredScratch.set(enemy.vehicle.position.x, enemy.floorY, enemy.vehicle.position.z);
      const resolved = this.resolveEnemyMovement(previous, desired);
      const blocked = resolved.x !== desired.x || resolved.z !== desired.z;
      enemy.vehicle.position.set(resolved.x, 0, resolved.z);
      if (blocked) enemy.vehicle.velocity.set(0, 0, 0);
      enemy.group.position.copy(resolved);
      const moved = this.enemyMovedScratch.subVectors(enemy.group.position, previous).setY(0);
      if (moved.lengthSq() > 0.0001 && enemy.state !== 'engage') {
        enemy.facing.lerp(moved.normalize(), Math.min(1, delta * 5));
        enemy.group.lookAt(this.enemyLookTargetScratch.copy(enemy.group.position).add(enemy.facing));
      }
      return;
    }
    this.run.objectiveText = aliveBossCount > 0
      ? `击败${bossObjective}，解除任务物品锁定（剩余 ${aliveBossCount}）`
      : this.activeOperation.objectiveText;
  }

  private updateEnemyAnimations(delta: number, now: number): void {
    for (const enemy of this.enemies) {
      const deltaX = enemy.group.position.x - enemy.lastAnimationPosition.x;
      const deltaZ = enemy.group.position.z - enemy.lastAnimationPosition.z;
      const actualDistance = Math.hypot(deltaX, deltaZ);
      enemy.lastAnimationPosition.copy(enemy.group.position);
      const previewWalking = enemy === this.debugPreviewWalkingEnemy;
      const travelled = previewWalking ? delta * 2.8 : actualDistance;
      const actuallyMoving = enemy.alive && travelled > 0.0002 && travelled < 1.4;
      const speed = actuallyMoving ? travelled / Math.max(delta, 0.001) : 0;
      const targetBlend = actuallyMoving ? THREE.MathUtils.clamp(speed / 3.1, 0.72, 1.12) : 0;
      const movementBlend = Math.min(1, delta * (actuallyMoving ? 9 : 6));
      enemy.movementBlend = THREE.MathUtils.lerp(enemy.movementBlend, targetBlend, movementBlend);
      if (actuallyMoving) {
        const strideDistance = enemy.boss ? 1.58 : 1.34;
        enemy.walkPhase = (enemy.walkPhase + travelled * Math.PI * 2 / strideDistance) % (Math.PI * 2);
      }
      this.updateEnemyAnimation(enemy, now, delta);
    }
  }

  private enemyMoveSpeed(enemy: EnemyRuntime, scale = 1): number {
    const bossSpeed = enemy.boss
      ? getBossCombatTuning(enemy.health, enemy.maxHealth, this.activeDifficulty).speedMultiplier
      : 1;
    return ENEMY_WALK_SPEED * bossSpeed * scale;
  }

  private updateEnemyTactics(enemy: EnemyRuntime, player: THREE.Vector3, distance: number, visible: boolean, now: number): void {
    const suppression = getEnemySuppressionResponse({
      now,
      lastSuppressedAt: enemy.lastSuppressedAt,
      elite: enemy.elite,
      boss: enemy.boss,
    });
    const difficultyBehavior = getEnemyDifficultyBehavior(this.activeDifficulty);
    const bossTuning = enemy.boss
      ? getBossCombatTuning(enemy.health, enemy.maxHealth, this.activeDifficulty)
      : null;
    if (now >= enemy.nextTacticAt || enemy.group.position.distanceTo(enemy.tacticalTarget) < 1.2) {
      enemy.tactic = bossTuning
        ? selectBossTactic({
          phase: bossTuning.phase,
          weaponId: enemy.weaponId,
          distance,
          holdDistance: bossTuning.holdDistance,
          visible,
          reloading: enemy.reloading,
          roll: Math.random(),
          suppressed: suppression.suppressed,
        })
        : selectEnemyTactic({
          weaponId: enemy.weaponId,
          healthRatio: enemy.health / enemy.maxHealth,
          distance,
          visible,
          reloading: enemy.reloading,
          roll: Math.random(),
          suppressed: suppression.suppressed,
        });
      let desired = player.clone().setY(enemy.floorY);
      if (enemy.tactic === 'cover') {
        desired = this.findEnemyCover(enemy, player) ?? enemy.group.position.clone();
      } else if (enemy.tactic === 'flank') {
        desired = this.makeFlankTarget(enemy, player);
        enemy.flankSide *= -1;
      } else if (enemy.tactic === 'retreat') {
        const away = enemy.group.position.clone().sub(player).setY(0).normalize();
        const side = new THREE.Vector3(-away.z, 0, away.x).multiplyScalar(enemy.flankSide * 3.5);
        desired = enemy.group.position.clone().addScaledVector(away, 9).add(side);
      }
      enemy.tacticalTarget.copy(this.makeReachableEnemyTarget(enemy, desired));
      enemy.seek.target.set(enemy.tacticalTarget.x, 0, enemy.tacticalTarget.z);
      enemy.nextTacticAt = now + ((enemy.tactic === 'flank' ? 2.25 : 1.45) + Math.random() * 0.65)
        * difficultyBehavior.tacticRefreshMultiplier
        * (bossTuning?.tacticRefreshMultiplier ?? 1)
        * this.threatEscalation.tacticRefreshMultiplier;
    }

    const weapon = ENEMY_WEAPON_CONFIGS[enemy.weaponId];
    const reachedTarget = enemy.group.position.distanceTo(enemy.tacticalTarget) < 1.25;
    const inPreferredRange = bossTuning
      ? visible && distance <= bossTuning.holdDistance
      : visible && distance >= weapon.preferredMin && distance <= weapon.preferredMax;
    if ((enemy.tactic === 'cover' && reachedTarget) || (enemy.tactic === 'advance' && inPreferredRange)) {
      enemy.vehicle.maxSpeed = 0;
      // Yuka 仍可能保留上一帧的惯性；停在掩体或射击距离时清掉它，
      // 避免 NPC 在目标点附近来回小幅摆动。
      enemy.vehicle.velocity.set(0, 0, 0);
    } else {
      const speedScale = (enemy.reloading ? 0.78 : enemy.tactic === 'flank' ? 1.08 : 1)
        * suppression.movementSpeedMultiplier
        * this.threatEscalation.movementMultiplier;
      enemy.vehicle.maxSpeed = this.enemyMoveSpeed(enemy, speedScale);
    }
  }

  private beginEnemySearch(enemy: EnemyRuntime, center: THREE.Vector3, now: number): void {
    const rememberedPosition = center.clone();
    enemy.searchCenter.copy(rememberedPosition);
    enemy.tacticalTarget.copy(rememberedPosition);
    enemy.searchStep = 0;
    enemy.searchPauseUntil = 0;
    enemy.searchEndsAt = now + 7 + Math.random() * 3;
    this.setEnemyState(enemy, 'search', rememberedPosition);
    enemy.seek.target.set(rememberedPosition.x, 0, rememberedPosition.z);
  }

  private updateEnemySearch(enemy: EnemyRuntime, now: number, delta: number): void {
    if (now >= enemy.searchEndsAt) {
      this.setEnemyState(enemy, 'return', enemy.home);
      return;
    }

    if (enemy.group.position.distanceTo(enemy.tacticalTarget) >= 1.65) {
      enemy.vehicle.maxSpeed = this.enemyMoveSpeed(enemy, 0.82);
      return;
    }

    enemy.vehicle.maxSpeed = 0;
    enemy.vehicle.velocity.set(0, 0, 0);
    if (enemy.searchPauseUntil === 0) {
      enemy.searchPauseUntil = now + 0.45 + Math.random() * 0.55;
    }

    const scanAngle = now * 1.35 + enemy.searchStep * 1.9 + enemy.home.x * 0.03;
    const scanDirection = this.enemyDirectionScratch.set(Math.cos(scanAngle), 0, Math.sin(scanAngle));
    enemy.facing.lerp(scanDirection, Math.min(1, delta * 1.7)).normalize();
    enemy.group.lookAt(this.enemyLookTargetScratch.copy(enemy.group.position).add(enemy.facing));
    if (now < enemy.searchPauseUntil) return;

    const plannedPoints = 2 + (Math.abs(Math.floor(enemy.home.x + enemy.home.z)) % 2);
    if (enemy.searchStep >= plannedPoints) {
      this.setEnemyState(enemy, 'return', enemy.home);
      return;
    }

    enemy.searchStep += 1;
    enemy.searchPauseUntil = 0;
    const nextPoint = this.makeEnemySearchPoint(enemy);
    enemy.tacticalTarget.copy(nextPoint);
    enemy.seek.target.set(nextPoint.x, 0, nextPoint.z);
    enemy.vehicle.maxSpeed = this.enemyMoveSpeed(enemy, 0.82);
  }

  private makeEnemySearchPoint(enemy: EnemyRuntime): THREE.Vector3 {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 3.5 + Math.random() * (3.5 + enemy.searchStep * 1.2);
      const candidate = enemy.searchCenter.clone().add(new THREE.Vector3(
        Math.cos(angle) * radius,
        0,
        Math.sin(angle) * radius,
      ));
      candidate.y = enemy.floorY;
      if (this.isEnemyPathClear(enemy.group.position, candidate)) return candidate;
    }
    return this.makeReachableEnemyTarget(enemy, enemy.searchCenter);
  }

  private makeFlankTarget(enemy: EnemyRuntime, player: THREE.Vector3): THREE.Vector3 {
    const towardPlayer = player.clone().sub(enemy.group.position).setY(0).normalize();
    const side = new THREE.Vector3(-towardPlayer.z, 0, towardPlayer.x).multiplyScalar(enemy.flankSide);
    const flankDistance = enemy.weaponId === 'shotgun' ? 7 : 9;
    const advanceDistance = enemy.weaponId === 'shotgun' ? 7 : 3.5;
    return enemy.group.position.clone().addScaledVector(side, flankDistance).addScaledVector(towardPlayer, advanceDistance);
  }

  private findEnemyCover(enemy: EnemyRuntime, player: THREE.Vector3): THREE.Vector3 | null {
    const playerEye = player.clone();
    for (const radius of [4.5, 7]) {
      for (let index = 0; index < 10; index += 1) {
        const angle = (index / 10) * Math.PI * 2 + enemy.flankSide * 0.35;
        const candidate = enemy.group.position.clone().add(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
        candidate.y = enemy.floorY;
        if (!this.isEnemyPathClear(enemy.group.position, candidate)) continue;
        const candidateEye = candidate.clone().add(new THREE.Vector3(0, 1.45, 0));
        if (!this.hasLineOfSight(playerEye, candidateEye)) return candidate;
      }
    }
    return null;
  }

  private makeReachableEnemyTarget(enemy: EnemyRuntime, desired: THREE.Vector3): THREE.Vector3 {
    const origin = enemy.group.position;
    if (this.isEnemyPathClear(origin, desired)) return desired;
    const forward = desired.clone().sub(origin).setY(0).normalize();
    const side = new THREE.Vector3(-forward.z, 0, forward.x);
    for (const direction of [enemy.flankSide, -enemy.flankSide]) {
      const waypoint = origin.clone().addScaledVector(forward, 3.2).addScaledVector(side, direction * 5.5);
      waypoint.y = enemy.floorY;
      if (this.isEnemyPathClear(origin, waypoint)) return waypoint;
    }
    return origin.clone();
  }

  private updateEnemyAnimation(enemy: EnemyRuntime, now: number, delta: number): void {
    const blend = Math.min(1, delta * 9);
    const leftKnee = enemy.leftLeg.userData.knee as THREE.Group;
    const rightKnee = enemy.rightLeg.userData.knee as THREE.Group;
    const leftBoot = enemy.leftLeg.userData.boot as THREE.Mesh;
    const rightBoot = enemy.rightLeg.userData.boot as THREE.Mesh;
    const leftElbow = enemy.leftArm.userData.elbow as THREE.Group;
    const rightElbow = enemy.rightArm.userData.elbow as THREE.Group;
    if (!enemy.alive) {
      const progress = THREE.MathUtils.smoothstep((now - enemy.deathStartedAt) / 0.72, 0, 1);
      enemy.group.rotation.z = enemy.deathSide * progress * Math.PI * 0.48;
      enemy.group.position.y = enemy.floorY + progress * 0.36;
      enemy.torso.rotation.x = THREE.MathUtils.lerp(enemy.torso.rotation.x, 0.08, blend);
      enemy.torso.rotation.y = THREE.MathUtils.lerp(enemy.torso.rotation.y, 0, blend);
      enemy.torso.rotation.z = THREE.MathUtils.lerp(enemy.torso.rotation.z, 0, blend);
      enemy.headRig.rotation.x = THREE.MathUtils.lerp(enemy.headRig.rotation.x, 0.18, blend);
      enemy.headRig.rotation.z = THREE.MathUtils.lerp(enemy.headRig.rotation.z, 0, blend);
      enemy.leftArm.rotation.x = THREE.MathUtils.lerp(enemy.leftArm.rotation.x, -1.2, blend);
      enemy.rightArm.rotation.x = THREE.MathUtils.lerp(enemy.rightArm.rotation.x, 0.85, blend);
      enemy.leftLeg.rotation.x = THREE.MathUtils.lerp(enemy.leftLeg.rotation.x, 0.45, blend);
      enemy.rightLeg.rotation.x = THREE.MathUtils.lerp(enemy.rightLeg.rotation.x, -0.25, blend);
      leftKnee.rotation.x = THREE.MathUtils.lerp(leftKnee.rotation.x, 0.7, blend);
      rightKnee.rotation.x = THREE.MathUtils.lerp(rightKnee.rotation.x, 0.25, blend);
      leftBoot.rotation.x = THREE.MathUtils.lerp(leftBoot.rotation.x, -0.3, blend);
      rightBoot.rotation.x = THREE.MathUtils.lerp(rightBoot.rotation.x, 0.15, blend);
      enemy.weapon.rotation.x = THREE.MathUtils.lerp(enemy.weapon.rotation.x, -0.12, blend);
      enemy.weapon.rotation.y = THREE.MathUtils.lerp(enemy.weapon.rotation.y, 0.12, blend);
      enemy.weapon.rotation.z = THREE.MathUtils.lerp(enemy.weapon.rotation.z, enemy.deathSide * 0.8, blend);
      enemy.weapon.position.y = THREE.MathUtils.lerp(enemy.weapon.position.y, 1.04, blend);
      return;
    }

    const walking = enemy.movementBlend > 0.025;
    const strideSin = Math.sin(enemy.walkPhase);
    const stride = strideSin * 0.46 * enemy.movementBlend;
    const leftSwing = Math.max(0, -strideSin) * enemy.movementBlend;
    const rightSwing = Math.max(0, strideSin) * enemy.movementBlend;
    const walkBob = (Math.abs(strideSin) - 0.5) * 0.026 * enemy.movementBlend;
    const breathing = Math.sin(now * 1.65 + enemy.home.z * 0.11) * (enemy.state === 'engage' ? 0.008 : 0.014);
    const stanceSide = Math.sin(enemy.home.x * 0.37 + enemy.home.z * 0.21) >= 0 ? 1 : -1;
    const idleSway = walking ? 0 : Math.sin(now * 0.62 + enemy.home.z * 0.13) * 0.018;
    const headScan = enemy.state === 'patrol' || enemy.state === 'search' || enemy.state === 'investigate'
      ? Math.sin(now * 0.72 + enemy.home.x * 0.09) * 0.16
      : 0;
    const torsoPitch = walking ? -0.075 - enemy.movementBlend * 0.026 : enemy.state === 'engage' ? -0.09 : -0.035;
    const torsoRoll = walking ? -stride * 0.045 : idleSway + stanceSide * 0.012;
    enemy.torso.position.y = THREE.MathUtils.lerp(enemy.torso.position.y, breathing + walkBob, blend);
    enemy.torso.rotation.x = THREE.MathUtils.lerp(enemy.torso.rotation.x, torsoPitch, blend);
    enemy.torso.rotation.y = THREE.MathUtils.lerp(enemy.torso.rotation.y, walking ? -stride * 0.08 : 0, blend);
    enemy.torso.rotation.z = THREE.MathUtils.lerp(enemy.torso.rotation.z, torsoRoll, blend);
    enemy.headRig.position.y = THREE.MathUtils.lerp(enemy.headRig.position.y, breathing * 0.55 + walkBob, blend);
    enemy.headRig.rotation.x = THREE.MathUtils.lerp(enemy.headRig.rotation.x, enemy.state === 'engage' ? 0.055 : 0.025, blend);
    enemy.headRig.rotation.y = THREE.MathUtils.lerp(enemy.headRig.rotation.y, headScan, blend * 0.55);
    enemy.headRig.rotation.z = THREE.MathUtils.lerp(enemy.headRig.rotation.z, -torsoRoll * 0.65, blend);
    enemy.leftLeg.rotation.x = THREE.MathUtils.lerp(enemy.leftLeg.rotation.x, stride, blend);
    enemy.rightLeg.rotation.x = THREE.MathUtils.lerp(enemy.rightLeg.rotation.x, -stride, blend);
    enemy.leftLeg.position.y = THREE.MathUtils.lerp(enemy.leftLeg.position.y, 0.79 + leftSwing * 0.028, blend);
    enemy.rightLeg.position.y = THREE.MathUtils.lerp(enemy.rightLeg.position.y, 0.79 + rightSwing * 0.028, blend);
    enemy.leftLeg.rotation.z = THREE.MathUtils.lerp(enemy.leftLeg.rotation.z, 0.016 + stanceSide * 0.004, blend);
    enemy.rightLeg.rotation.z = THREE.MathUtils.lerp(enemy.rightLeg.rotation.z, -0.016 + stanceSide * 0.004, blend);
    const leftKneeTarget = 0.07 + leftSwing * 0.82;
    const rightKneeTarget = 0.07 + rightSwing * 0.82;
    leftKnee.rotation.x = THREE.MathUtils.lerp(leftKnee.rotation.x, leftKneeTarget, blend);
    rightKnee.rotation.x = THREE.MathUtils.lerp(rightKnee.rotation.x, rightKneeTarget, blend);
    leftBoot.rotation.x = THREE.MathUtils.lerp(leftBoot.rotation.x, -(stride + leftKneeTarget - 0.07) * 0.78, blend);
    rightBoot.rotation.x = THREE.MathUtils.lerp(rightBoot.rotation.x, -(-stride + rightKneeTarget - 0.07) * 0.78, blend);
    const elbowMotion = walking ? stride * 0.08 : 0;
    leftElbow.rotation.x = THREE.MathUtils.lerp(leftElbow.rotation.x, -0.94 - elbowMotion, blend);
    rightElbow.rotation.x = THREE.MathUtils.lerp(rightElbow.rotation.x, -0.94 + elbowMotion, blend);
    leftElbow.rotation.z = THREE.MathUtils.lerp(leftElbow.rotation.z, 0.88 - elbowMotion * 0.45, blend);
    rightElbow.rotation.z = THREE.MathUtils.lerp(rightElbow.rotation.z, -0.88 - elbowMotion * 0.45, blend);

    if (enemy.reloading) {
      const config = ENEMY_WEAPON_CONFIGS[enemy.weaponId];
      const reloadProgress = THREE.MathUtils.clamp(1 - (enemy.reloadEndsAt - now) / config.reloadDuration, 0, 1);
      const motion = Math.sin(reloadProgress * Math.PI);
      enemy.leftArm.rotation.x = THREE.MathUtils.lerp(enemy.leftArm.rotation.x, -0.7 - motion * 0.8, blend);
      enemy.rightArm.rotation.x = THREE.MathUtils.lerp(enemy.rightArm.rotation.x, -0.35 + motion * 0.45, blend);
      leftElbow.rotation.x = THREE.MathUtils.lerp(leftElbow.rotation.x, -1.12 + motion * 0.24, blend);
      rightElbow.rotation.x = THREE.MathUtils.lerp(rightElbow.rotation.x, -0.82 - motion * 0.18, blend);
      leftElbow.rotation.z = THREE.MathUtils.lerp(leftElbow.rotation.z, 1.02 + motion * 0.18, blend);
      rightElbow.rotation.z = THREE.MathUtils.lerp(rightElbow.rotation.z, -0.78, blend);
      enemy.weapon.rotation.x = -0.12 + motion * 0.72;
      enemy.weapon.rotation.y = THREE.MathUtils.lerp(enemy.weapon.rotation.y, 0.18, blend);
      enemy.weapon.rotation.z = motion * -0.38;
      enemy.weapon.position.y = 1.18 - motion * 0.18;
      enemy.headRig.rotation.y = THREE.MathUtils.lerp(enemy.headRig.rotation.y, -0.18, blend);
      enemy.headRig.rotation.x = THREE.MathUtils.lerp(enemy.headRig.rotation.x, 0.12, blend);
      return;
    }

    if (now < enemy.hurtEndsAt) {
      const duration = 0.34;
      const progress = THREE.MathUtils.clamp(1 - (enemy.hurtEndsAt - now) / duration, 0, 1);
      // A single recoil pulse reads as impact. Repeated sine waves made enemies
      // visibly shiver when several bullets landed in quick succession.
      const impact = Math.sin(progress * Math.PI);
      const lean = impact * (enemy.boss ? 0.09 : enemy.elite ? 0.17 : 0.25);
      enemy.torso.rotation.x = -lean;
      enemy.headRig.rotation.x = lean * 0.72;
      enemy.torso.rotation.z = enemy.deathSide * impact * 0.1;
      enemy.headRig.rotation.z = -enemy.deathSide * impact * 0.07;
      enemy.leftArm.rotation.x = -0.8;
      enemy.rightArm.rotation.x = 0.65;
      enemy.weapon.rotation.z = enemy.deathSide * impact * 0.14;
      return;
    }

    const warningPose = enemy.attackWarning.phase === 'warning' ? -0.38 : -0.51;
    const aimingPose = enemy.state === 'engage' ? warningPose : -0.24;
    const armStride = walking ? stride * 0.09 : 0;
    const recoil = Math.exp(-Math.max(0, now - enemy.lastFiredAt) * 17) * 0.09;
    enemy.leftArm.rotation.x = THREE.MathUtils.lerp(enemy.leftArm.rotation.x, aimingPose - armStride, blend);
    enemy.rightArm.rotation.x = THREE.MathUtils.lerp(
      enemy.rightArm.rotation.x,
      aimingPose + armStride + (enemy.state === 'engage' ? 0 : stanceSide * 0.035),
      blend,
    );
    const armCant = enemy.state === 'engage' ? 0.025 : 0.05;
    enemy.leftArm.rotation.z = THREE.MathUtils.lerp(enemy.leftArm.rotation.z, armCant, blend);
    enemy.rightArm.rotation.z = THREE.MathUtils.lerp(enemy.rightArm.rotation.z, -armCant, blend);
    enemy.weapon.rotation.x = THREE.MathUtils.lerp(
      enemy.weapon.rotation.x,
      (enemy.state === 'engage' ? -0.03 : -0.11) + recoil,
      blend,
    );
    enemy.weapon.rotation.y = THREE.MathUtils.lerp(enemy.weapon.rotation.y, enemy.state === 'engage' ? 0.07 : 0.2, blend);
    enemy.weapon.rotation.z = THREE.MathUtils.lerp(enemy.weapon.rotation.z, enemy.state === 'engage' ? 0 : -0.025, blend);
    enemy.weapon.position.x = THREE.MathUtils.lerp(enemy.weapon.position.x, enemy.state === 'engage' ? 0.08 : 0.06, blend);
    enemy.weapon.position.y = THREE.MathUtils.lerp(enemy.weapon.position.y, 1.18 + breathing * 0.45, blend);
    enemy.weapon.position.z = THREE.MathUtils.lerp(enemy.weapon.position.z, 0.22 - recoil * 0.28, blend);
  }

  private resolveEnemyMovement(previous: THREE.Vector3, desired: THREE.Vector3): THREE.Vector3 {
    if (this.isEnemyPathClear(previous, desired)) return desired;

    // Trying each axis separately lets enemies slide along a wall instead of crossing it.
    const alongX = new THREE.Vector3(desired.x, desired.y, previous.z);
    if (this.isEnemyPathClear(previous, alongX)) return alongX;
    const alongZ = new THREE.Vector3(previous.x, desired.y, desired.z);
    if (this.isEnemyPathClear(previous, alongZ)) return alongZ;
    return new THREE.Vector3(previous.x, desired.y, previous.z);
  }

  private isEnemyPathClear(start: THREE.Vector3, end: THREE.Vector3): boolean {
    const movement = end.clone().sub(start).setY(0);
    const distance = movement.length();
    if (distance < 0.0001) return true;
    const direction = movement.multiplyScalar(1 / distance);
    const side = new THREE.Vector3(-direction.z, 0, direction.x);
    const enemyRadius = 0.34;

    for (const offset of [0, -enemyRadius, enemyRadius]) {
      const origin = start.clone().addScaledVector(side, offset);
      origin.y = Math.max(start.y, end.y) + 1;
      const hit = this.physicsWorld.castRay(
        new RAPIER.Ray(
          { x: origin.x, y: origin.y, z: origin.z },
          { x: direction.x, y: 0, z: direction.z },
        ),
        distance + 0.08,
        true,
      );
      if (hit) return false;
    }
    return true;
  }

  private updateBossFloorTarget(enemy: EnemyRuntime, player: THREE.Vector3, delta: number): void {
    const targetY = player.y > 3.1 ? ADMIN_UPPER_FLOOR_Y : 0;
    if (Math.abs(enemy.floorY - targetY) < 0.08) {
      enemy.floorY = targetY;
      return;
    }
    const nearestStair = ADMIN_STAIRS.reduce((best, stair) => {
      const bestDistance = Math.hypot(enemy.vehicle.position.x - best.x, enemy.vehicle.position.z - best.z);
      const distance = Math.hypot(enemy.vehicle.position.x - stair.x, enemy.vehicle.position.z - stair.z);
      return distance < bestDistance ? stair : best;
    });
    const stairDistance = Math.hypot(enemy.vehicle.position.x - nearestStair.x, enemy.vehicle.position.z - nearestStair.z);
    if (stairDistance > 2.8) {
      enemy.seek.target.set(nearestStair.x, 0, nearestStair.z);
      enemy.vehicle.maxSpeed = this.enemyMoveSpeed(enemy);
      return;
    }
    enemy.floorY = THREE.MathUtils.lerp(enemy.floorY, targetY, Math.min(1, delta * 1.7));
    enemy.vehicle.maxSpeed = 0;
  }

  private setEnemyState(enemy: EnemyRuntime, state: EnemyState, target: THREE.Vector3): void {
    if (enemy.state === state) return;
    const previous = enemy.state;
    enemy.state = state;
    if (state !== 'engage') enemy.factionTarget = null;
    if (state === 'engage' && previous !== 'engage') {
      enemy.alertLight.intensity = enemy.elite ? 7 : 3;
      if (enemy.boss) this.refreshBossHud(enemy);
      const now = performance.now() / 1000;
      const alertedAllies = this.alertNearbyEnemies(enemy, target, now);
      if (now - this.lastThreatWarningAt > 2.4) {
        this.lastThreatWarningAt = now;
        const callout = alertedAllies > 0 ? `附近 ${alertedAllies} 名敌人正在包抄` : '敌人正在接敌';
        this.callbacks.onToast(`威胁警告：${enemy.name}发现玩家 · ${callout}`, 'danger');
      }
    }
    if (previous !== state) enemy.lastStateChange = performance.now() / 1000;
    enemy.vehicle.steering.clear();
    if (state === 'patrol') {
      enemy.perception.awareness = 0;
      enemy.vehicle.maxSpeed = this.enemyMoveSpeed(enemy);
      enemy.vehicle.steering.add(new YUKA.FollowPathBehavior(enemy.path, 0.7));
    } else if (state !== 'dead') {
      enemy.seek.target.set(target.x, 0, target.z);
      enemy.vehicle.maxSpeed = this.enemyMoveSpeed(enemy);
      enemy.vehicle.steering.add(enemy.seek);
    }
  }

  private alertNearbyEnemies(source: EnemyRuntime, target: THREE.Vector3, now: number): number {
    const behavior = getEnemyDifficultyBehavior(this.activeDifficulty);
    if (now - source.lastCallAt < behavior.coordinationCooldown) return 0;
    source.lastCallAt = now;
    let alerted = 0;
    for (const ally of this.enemies) {
      if (ally === source) continue;
      if (ally.faction !== source.faction) continue;
      const distance = ally.group.position.distanceTo(source.group.position);
      const radius = (source.boss ? behavior.coordinationRadius * 1.25 : behavior.coordinationRadius)
        * this.threatEscalation.coordinationMultiplier;
      if (!shouldAlertAlly({ distance, alive: ally.alive, state: ally.state, radius })) continue;
      const reportedPosition = this.makeImperfectEnemyMemory(target, source.boss ? 1.2 : 2.8);
      ally.lastSeen.copy(reportedPosition);
      ally.nextTacticAt = now + 0.25 + alerted * 0.08;
      this.setEnemyState(ally, 'investigate', reportedPosition);
      alerted += 1;
      if (alerted >= behavior.maxCoordinatedAllies) break;
    }
    return alerted;
  }

  private countNearbyAllies(source: EnemyRuntime): number {
    const radius = getEnemyDifficultyBehavior(this.activeDifficulty).coordinationRadius
      * this.threatEscalation.coordinationMultiplier;
    return this.enemies.filter((ally) => ally !== source
      && ally.alive
      && ally.faction === source.faction
      && ally.group.position.distanceToSquared(source.group.position) <= radius * radius).length;
  }

  private enemyFire(enemy: EnemyRuntime, distance: number, now: number): void {
    const difficulty = DIFFICULTIES[this.activeDifficulty];
    const weapon = ENEMY_WEAPON_CONFIGS[enemy.weaponId];
    const suppression = getEnemySuppressionResponse({
      now,
      lastSuppressedAt: enemy.lastSuppressedAt,
      elite: enemy.elite,
      boss: enemy.boss,
    });
    const bossTuning = enemy.boss
      ? getBossCombatTuning(enemy.health, enemy.maxHealth, this.activeDifficulty)
      : null;
    if (enemy.reloading) return;
    if (enemy.ammo <= 0) {
      this.startEnemyReload(enemy, now);
      return;
    }
    const baseBossBurst = enemy.weaponId === 'smg' ? 8 : enemy.weaponId === 'shotgun' ? 2 : 1;
    const bossBurst = Math.ceil(baseBossBurst * (bossTuning?.burstMultiplier ?? 1));
    if (enemy.burstRemaining <= 0) {
      const normalBurst = enemy.boss ? bossBurst : weapon.burstSize;
      enemy.burstRemaining = Math.max(1, Math.ceil(normalBurst * suppression.burstSizeMultiplier));
    } else if (suppression.suppressed && !enemy.boss) {
      enemy.burstRemaining = Math.min(enemy.burstRemaining, 1);
    }
    enemy.burstRemaining -= 1;
    enemy.ammo -= 1;
    enemy.lastFiredAt = now;
    const bossBurstDelay = weapon.fireInterval * (bossTuning?.shotDelayMultiplier ?? 1);
    const bossPause = weapon.burstPause * (bossTuning?.burstPauseMultiplier ?? 1) + Math.random() * 0.18;
    enemy.fireCooldown = (
      enemy.burstRemaining > 0
        ? (enemy.boss ? bossBurstDelay : weapon.fireInterval)
        : (enemy.boss ? bossPause : weapon.burstPause + Math.random() * 0.5)
    ) * difficulty.fireDelay * this.threatEscalation.fireDelayMultiplier;
    if (enemy.boss) {
      enemy.muzzleLight.intensity = 11;
      enemy.muzzleLight.visible = true;
    }
    const muzzleZ = Number(enemy.weapon.userData.muzzleZ ?? 0.9);
    const origin = enemy.weapon.localToWorld(this.enemyMuzzleScratch.set(0, 0, muzzleZ));
    this.audio.enemyShot(weapon.shotVolume, origin, this.acousticSpaceAt(origin));
    const accuracy = THREE.MathUtils.clamp(
      (weapon.baseAccuracy - distance * weapon.distanceFalloff)
        * difficulty.accuracy
        * this.threatEscalation.accuracyMultiplier
        * suppression.accuracyMultiplier
        * (bossTuning?.phase === 'desperate' ? 1.34 : bossTuning?.phase === 'pressure' ? 1.24 : enemy.boss ? 1.12 : 1),
      suppression.suppressed ? 0.025 : enemy.weaponId === 'shotgun' ? 0.1 : 0.08,
      enemy.boss ? (bossTuning?.phase === 'desperate' ? 0.82 : 0.78) : enemy.weaponId === 'sniper' ? 0.62 : 0.5,
    );
    let totalDamage = 0;
    let closestWhiz: ReturnType<typeof closestPointOnSegment> | null = null;
    for (let pellet = 0; pellet < weapon.pelletCount; pellet += 1) {
      const target = this.camera.position.clone();
      const hit = Math.random() < accuracy;
      const spread = enemy.weaponId === 'shotgun' ? 3.8 : 2.7;
      if (!hit) target.add(new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * 2 - 0.5, (Math.random() - 0.5) * spread));
      if (pellet < 4) this.createTracer(origin, target);
      if (hit) totalDamage += weapon.damageMin + Math.random() * (weapon.damageMax - weapon.damageMin);
      else {
        const proximity = closestPointOnSegment(origin, target, this.camera.position);
        if (shouldPlayBulletWhiz(proximity.distance, false)
          && (!closestWhiz || proximity.distance < closestWhiz.distance)) {
          closestWhiz = proximity;
        }
      }
    }
    if (closestWhiz) {
      this.audio.bulletWhiz(
        new THREE.Vector3(closestWhiz.point.x, closestWhiz.point.y, closestWhiz.point.z),
        closestWhiz.distance,
      );
    }
    const bossDamage = enemy.enraged ? 2.3 : 2;
    if (totalDamage > 0) {
      const baseAmmoLevel: AmmoLevel = enemy.weaponId === 'sniper' ? 5 : enemy.weaponId === 'shotgun' ? 2 : 2;
      const enemyAmmoLevel = Math.min(6, baseAmmoLevel + (enemy.boss ? 1 : 0)) as AmmoLevel;
      this.damagePlayer(
        totalDamage
        * difficulty.damage
        * this.threatEscalation.damageMultiplier
        * (enemy.boss ? bossDamage : enemy.elite ? 1.28 : 1),
        this.randomPlayerBodyPart(),
        enemyAmmoLevel,
      );
    }
    if (enemy.ammo <= 0) this.startEnemyReload(enemy, now);
  }

  private startEnemyReload(enemy: EnemyRuntime, now: number): void {
    if (enemy.reloading) return;
    const config = ENEMY_WEAPON_CONFIGS[enemy.weaponId];
    enemy.reloading = true;
    enemy.reloadEndsAt = now + config.reloadDuration;
    enemy.burstRemaining = 0;
    enemy.fireCooldown = config.reloadDuration;
    enemy.nextTacticAt = 0;
    if (enemy.group.position.distanceTo(this.camera.position) < 30) this.audio.voice('换弹，掩护我！', enemy.group.position.distanceTo(this.camera.position));
  }

  private hasLineOfSight(origin: THREE.Vector3, target: THREE.Vector3): boolean {
    const abilityNow = this.run.elapsedSeconds;
    for (const smoke of this.smokes) {
      if (abilityNow >= smoke.endsAt) continue;
      const bloom = THREE.MathUtils.clamp((abilityNow - smoke.startedAt) / 1.15, 0.18, 1);
      if (lineSegmentIntersectsSphere(origin, target, smoke.position, smoke.radius * bloom)) return false;
    }
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

  private randomPlayerBodyPart(): BodyPart {
    const roll = Math.random();
    if (roll < 0.12) return 'head';
    if (roll < 0.62) return 'torso';
    if (roll < 0.72) return 'leftArm';
    if (roll < 0.82) return 'rightArm';
    if (roll < 0.91) return 'leftLeg';
    return 'rightLeg';
  }

  private damagePlayer(rawDamage: number, bodyPart = this.randomPlayerBodyPart(), ammoLevel: AmmoLevel = 2): void {
    if (!['active', 'extracting'].includes(this.run.phase)) return;
    if (this.lootSearch) this.cancelLootSearch('受到攻击，搜索中断');
    const ballistic = resolveBallisticHit(
      rawDamage,
      this.run.player.armorDurability,
      ammoLevel,
      this.run.player.armorLevel,
    );
    this.run.player.armorDurability = ballistic.armorDurability;
    this.run.player.armor = ballistic.armorDurability;
    this.run.player.injuries = applyBodyInjury(this.run.player.injuries, bodyPart, ballistic.healthDamage);
    this.run.player.health = Math.max(0, this.run.player.health - ballistic.healthDamage);
    this.run.player.weaponDurability = wearDurability(this.run.player.weaponDurability, this.run.player.maxWeaponDurability, 0.02);
    const now = performance.now() / 1000;
    this.run.combatLog = [...this.run.combatLog.slice(-119), {
      atSeconds: this.run.elapsedSeconds,
      direction: 'received',
      bodyPart,
      ammoLevel,
      armorLevel: this.run.player.armorLevel,
      rawDamage,
      healthDamage: ballistic.healthDamage,
      armorDamage: ballistic.armorDamage,
      penetrated: ballistic.penetrated,
    }];
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
    if (bodyPart.includes('Leg') || bodyPart.includes('Arm')) {
      this.callbacks.onToast(bodyPart.includes('Leg') ? '腿部受伤 · 移动速度下降' : '手臂受伤 · 瞄准晃动增加', 'danger');
    }
    this.challengeProgress = updateChallengeSet(
      this.challengeProgress,
      this.challengeDefinitions,
      { type: 'damage', amount: ballistic.healthDamage },
    );
    this.audio.tone(82, 0.12, 0.07);
    if (this.run.player.health <= 0) this.failRun('人员失联');
  }

  private useMedkit(): void {
    if (!['active', 'extracting'].includes(this.run.phase)) return;
    if (this.healingEndsAt > 0) return;
    if (this.run.player.injuries.bleeding > 0 && this.run.player.bandages > 0) {
      this.run.player.bandages -= 1;
      this.healingTreatment = 'bandage';
    } else if ((this.run.player.injuries.leftLeg + this.run.player.injuries.rightLeg) > 0 && this.run.player.splints > 0) {
      this.run.player.splints -= 1;
      this.healingTreatment = 'splint';
    } else if (this.run.player.medkits > 0 && this.run.player.health < 100) {
      this.run.player.medkits -= 1;
      this.healingTreatment = 'medkit';
    } else {
      this.callbacks.onToast('没有对应的治疗物品', 'danger');
      return;
    }
    this.healingEndsAt = performance.now() / 1000 + 1.25;
    this.callbacks.onToast(this.healingTreatment === 'bandage' ? '正在止血' : this.healingTreatment === 'splint' ? '正在固定伤肢' : '正在处理生命伤势');
    this.audio.tone(360, 0.08, 0.035);
  }

  private completeHealing(now: number): void {
    if (this.healingEndsAt === 0 || now < this.healingEndsAt) return;
    this.healingEndsAt = 0;
    if (this.healingTreatment === 'bandage') this.run.player.injuries = { ...this.run.player.injuries, bleeding: 0 };
    else if (this.healingTreatment === 'splint') this.run.player.injuries = { ...this.run.player.injuries, leftLeg: Math.max(0, this.run.player.injuries.leftLeg - 1) as 0 | 1 | 2, rightLeg: Math.max(0, this.run.player.injuries.rightLeg - 1) as 0 | 1 | 2 };
    else this.run.player.health = Math.min(100, this.run.player.health + 35);
    this.callbacks.onToast(this.healingTreatment === 'bandage' ? '出血已停止' : this.healingTreatment === 'splint' ? '腿部伤势已固定' : '生命状态已稳定');
    this.audio.tone(620, 0.12, 0.04);
  }

  private updateInteraction(): void {
    if (this.lootSearch) {
      this.nearestInteraction = this.lootSearch.entry;
      this.callbacks.onPrompt(this.lootSearch.revealed ? '收入已识别物资' : '正在搜索容器');
      return;
    }
    const playerPosition = this.camera.position;
    let nearest: LootRuntime | 'objective' | 'checkpoint' | 'task-item' | 'task-radio' | 'extract-condition' | 'secret-reader' | 'field-trader' | null = null;
    let nearestDistance = 2.35;
    const traderPosition = this.activeOperation.spawn;
    const traderDistance = Math.hypot(playerPosition.x - traderPosition.x, playerPosition.z - traderPosition.z);
    if (traderDistance < nearestDistance) {
      nearest = 'field-trader';
      nearestDistance = traderDistance;
    }
    if (this.highValueTaskStage === 'collect' && this.taskHardDrive.visible) {
      const distance = playerPosition.distanceTo(this.taskHardDrive.position);
      if (distance < nearestDistance) {
        nearest = 'task-item';
        nearestDistance = distance;
      }
    }
    if (this.highValueTaskStage === 'deliver' && this.taskRadio.visible) {
      const distance = playerPosition.distanceTo(this.taskRadio.position);
      if (distance < nearestDistance) {
        nearest = 'task-radio';
        nearestDistance = distance;
      }
    }
    if (this.activeOperation.id === 'reservoir' && this.missionTerminal.visible && !this.reservoirTerminalActivated) {
      const distance = playerPosition.distanceTo(this.missionTerminal.position);
      if (distance < nearestDistance) {
        nearest = 'checkpoint';
        nearestDistance = distance;
      }
    }
    if (this.activeOperation.id === 'administration' && !this.administrationSecretUnlocked) {
      const distance = playerPosition.distanceTo(this.administrationSecretReader.position);
      if (distance < nearestDistance) {
        nearest = 'secret-reader';
        nearestDistance = distance;
      }
    }
    if (this.objectiveCase.visible) {
      const distance = playerPosition.distanceTo(this.objectiveCase.position);
      if (distance < nearestDistance) {
        nearest = 'objective';
        nearestDistance = distance;
      }
    }
    const extractionDistance = Math.hypot(
      playerPosition.x - this.activeOperation.extraction.x,
      playerPosition.z - this.activeOperation.extraction.z,
    );
    const manualExtractionCondition = ['pay-credits', 'restore-power'].includes(this.operationScenario.extractionCondition.type);
    if (manualExtractionCondition && this.isCoreMissionReady() && !this.extractionConditionProgress.completed
      && extractionDistance < nearestDistance) {
      nearest = 'extract-condition';
      nearestDistance = extractionDistance;
    }
    for (const entry of this.loot) {
      if (entry.opened || entry.operationId !== this.activeOperation.id) continue;
      const distance = playerPosition.distanceTo(entry.position);
      if (distance < nearestDistance) {
        nearest = entry;
        nearestDistance = distance;
      }
    }
    for (const entry of this.corpseLoot) {
      if (entry.opened) continue;
      const distance = playerPosition.distanceTo(entry.position);
      if (distance < nearestDistance) {
        nearest = entry;
        nearestDistance = distance;
      }
    }
    this.nearestInteraction = nearest;
    if (nearest === 'objective') {
      const taskPrompt = this.operationScenario.task.type === 'rescue'
        ? '救出失联人员'
        : this.operationScenario.task.type === 'plant-bomb'
          ? '安装并启动爆破装置'
          : this.operationScenario.task.type === 'escort'
            ? '取得需要护送的密封货箱'
            : null;
      this.callbacks.onPrompt(taskPrompt ?? (this.activeOperation.id === 'administration' ? '取得中央档案' : '回收任务物品'));
    }
    else if (nearest === 'checkpoint') this.callbacks.onPrompt('激活地下主控终端');
    else if (nearest === 'task-item') this.callbacks.onPrompt('拾取高价值任务硬盘');
    else if (nearest === 'task-radio') this.callbacks.onPrompt('向军用电台交付硬盘');
    else if (nearest === 'secret-reader') {
      const hasCard = this.run.backpack.some((item) => item.id === ADMIN_SECRET_CARD_ID && item.quantity > 0);
      this.callbacks.onPrompt(hasCard ? '刷卡开启二楼秘密档案室' : '需要行政主楼档案室房卡');
    }
    else if (nearest === 'field-trader') this.callbacks.onPrompt('E 打开局内黑市 · 用背包物资兑换弹药/医疗/情报');
    else if (nearest === 'extract-condition') this.callbacks.onPrompt(this.modeLockedMessage());
    else if (nearest) this.callbacks.onPrompt(nearest.source === 'corpse' ? `搜索 ${nearest.containerName}` : `搜索 ${nearest.containerName}`);
    else this.callbacks.onPrompt(null);
  }

  private startLootSearch(entry: LootRuntime): void {
    this.lootSearch = {
      entry,
      startedAt: performance.now() / 1000,
      duration: Math.max(CONTAINER_RULES[entry.tier].search, entry.capacity * 0.38),
      revealed: false,
      revealedSlots: 0,
      phase: 'searching',
      nextRevealAt: 0,
    };
    this.firing = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.lastLootUiUpdatedAt = performance.now() / 1000;
    this.callbacks.onLootSearch({
      items: entry.items,
      equipment: entry.equipment,
      containerName: entry.containerName,
      phase: 'searching',
      progress: 0,
      message: '正在检索容器内容',
      source: entry.source,
      capacity: entry.capacity,
      boss: entry.boss,
      revealedSlots: 0,
      justRevealedSlot: null,
    });
    this.callbacks.onPrompt('逐格搜索中');
    this.audio.tone(300, 0.06, 0.025);
  }

  private updateLootSearch(now: number): void {
    const search = this.lootSearch;
    if (!search) return;
    if (search.phase === 'searching' && this.camera.position.distanceTo(search.entry.position) > 2.8) {
      this.cancelLootSearch('距离过远，搜索中断');
      return;
    }
    if (search.revealed) return;
    if (search.phase === 'searching') {
      const progress = THREE.MathUtils.clamp((now - search.startedAt) / search.duration, 0, 1);
      this.setContainerOpenProgress(search.entry.mesh, progress);
      if (progress < 1 && now - this.lastLootUiUpdatedAt < 0.05) return;
      this.lastLootUiUpdatedAt = now;
      this.callbacks.onLootSearch({
        items: search.entry.items,
        equipment: search.entry.equipment,
        containerName: search.entry.containerName,
        phase: 'searching',
        progress,
        message: '正在搜索容器 · 物品尚未识别',
        source: search.entry.source,
        capacity: search.entry.capacity,
        boss: search.entry.boss,
        revealedSlots: 0,
        justRevealedSlot: null,
      });
      if (progress < 1) return;
      search.phase = 'revealing';
      search.nextRevealAt = now + 0.22;
      this.callbacks.onLootSearch({
        items: search.entry.items,
        equipment: search.entry.equipment,
        containerName: search.entry.containerName,
        phase: 'revealing',
        progress: 1,
        message: `搜索完成 · 正在识别未知物品 0 / ${search.entry.capacity}`,
        source: search.entry.source,
        capacity: search.entry.capacity,
        boss: search.entry.boss,
        revealedSlots: 0,
        justRevealedSlot: null,
      });
      return;
    }
    if (now < search.nextRevealAt) return;
    const slot = search.revealedSlots;
    const item = search.entry.items[slot];
    if (item) this.playLootReveal(item);
    else this.audio.tone(340, 0.035, 0.012);
    search.revealedSlots = nextLootRevealCount(search.revealedSlots, search.entry.capacity);
    search.nextRevealAt = now + (item?.rarity === 'red' ? 0.48 : 0.25);
    if (search.revealedSlots < search.entry.capacity) {
      this.callbacks.onLootSearch({
        items: search.entry.items,
        equipment: search.entry.equipment,
        containerName: search.entry.containerName,
        phase: 'revealing',
        progress: 1,
        message: `正在逐件识别 · ${search.revealedSlots} / ${search.entry.capacity}`,
        source: search.entry.source,
        capacity: search.entry.capacity,
        boss: search.entry.boss,
        revealedSlots: search.revealedSlots,
        justRevealedSlot: slot,
      });
      return;
    }
    search.revealed = true;
    search.phase = 'revealed';
    this.callbacks.onLootSearch({
      items: search.entry.items,
      equipment: search.entry.equipment,
      containerName: search.entry.containerName,
      phase: 'revealed',
      progress: 1,
      message: '搜索完成 · 点击或拖动物品，也可全部拿取',
      source: search.entry.source,
      capacity: search.entry.capacity,
      boss: search.entry.boss,
      revealedSlots: search.entry.capacity,
      justRevealedSlot: slot,
    });
    this.callbacks.onPrompt('收入已识别物资');
  }

  private playLootReveal(item: InventoryItem): void {
    const rarityIndex = RARITY_ORDER.indexOf(item.rarity);
    const frequency = [380, 440, 530, 650, 790, 960, 1160][rarityIndex] ?? 440;
    if (item.rarity === 'red') {
      this.audio.tone(720, 0.18, 0.045);
      this.audio.tone(1080, 0.24, 0.028);
      return;
    }
    this.audio.tone(frequency, rarityIndex >= 5 ? 0.2 : 0.09, rarityIndex >= 4 ? 0.052 : 0.032);
    if (rarityIndex >= 5) this.audio.tone(Math.round(frequency * 1.42), 0.24, 0.025);
  }

  private takeSearchedLoot(): void {
    const search = this.lootSearch;
    if (!search?.revealed) return;
    let backpack = this.run.backpack;
    let collected = 0;
    const transferAll = (source: InventoryItem[]): InventoryItem[] => {
      const remaining: InventoryItem[] = [];
      for (const item of source) {
        const result = addInventoryItem(backpack, item, this.backpackCapacity);
        if (!result.added) {
          remaining.push(item);
          continue;
        }
        backpack = result.items;
        collected += 1;
        this.applyCollectedModeItem(item);
      }
      return remaining;
    };
    const remainingEquipment = transferAll(search.entry.equipment ?? []);
    const remainingItems = transferAll(search.entry.items);
    if (collected === 0) {
      this.callbacks.onToast('背包空间不足', 'danger');
      return;
    }
    this.run.backpack = backpack;
    search.entry.equipment = remainingEquipment;
    search.entry.items = remainingItems;
    if (this.operationScenario.task.type === 'timed-scavenge') this.advanceOperationTask(collected);
    this.callbacks.onUpdate(this.run);
    if (remainingEquipment.length > 0 || remainingItems.length > 0) {
      this.refreshOpenLootView('背包空间不足，未拿取物资仍保留在容器中');
      this.callbacks.onToast(`已取得 ${collected} 件物资 · 背包空间不足`, 'danger');
      return;
    }
    this.finishLootSearch(`已取得 ${collected} 件物资`);
  }

  private finishLootSearch(message: string): void {
    const search = this.lootSearch;
    if (!search) return;
    search.entry.opened = true;
    search.entry.mesh.visible = false;
    this.nearestInteraction = null;
    this.callbacks.onLootSearch(null);
    this.callbacks.onPrompt(null);
    this.callbacks.onToast(message);
    this.audio.tone(620, 0.1, 0.045);
    this.lootSearch = null;
  }

  takeLootItem(itemId: string): void {
    const search = this.lootSearch;
    if (!search?.revealed) return;
    const equipment = search.entry.equipment ?? [];
    const fromEquipment = equipment.some((item) => item.id === itemId);
    const source = fromEquipment ? equipment : search.entry.items;
    const collectedItem = source.find((item) => item.id === itemId);
    const transfer = transferInventoryItem(source, this.run.backpack, itemId, this.backpackCapacity);
    if (!transfer.transferred) {
      this.callbacks.onToast('背包空间不足', 'danger');
      return;
    }
    if (fromEquipment) search.entry.equipment = transfer.source;
    else search.entry.items = transfer.source;
    this.run.backpack = transfer.destination;
    if (collectedItem) this.applyCollectedModeItem(collectedItem);
    if (this.operationScenario.task.type === 'timed-scavenge') this.advanceOperationTask();
    this.callbacks.onUpdate(this.run);
    if (search.entry.items.length === 0 && (search.entry.equipment ?? []).length === 0) {
      this.finishLootSearch(`${search.entry.containerName}已搜刮完毕`);
      return;
    }
    this.refreshOpenLootView('已拿取物资 · 可继续点击或拖动');
  }

  takeCorpseLootItem(itemId: string): void { this.takeLootItem(itemId); }

  private applyCollectedModeItem(item: InventoryItem): void {
    if (this.activeGameMode === 'random-extract' && item.kind === 'intel' && !this.extractionIntelUnlocked) {
      this.extractionIntelUnlocked = true;
      this.setExtractionMarkerVisible(true);
      this.callbacks.onToast('撤离情报已解析 · 撤离坐标已标记');
      this.callbacks.onMiniMap(this.createMiniMapView());
    }
    if (this.activeGameMode !== 'zero' || item.kind !== 'weapon') return;
    const weaponId: WeaponId | null = item.variant === 'smg'
      ? 'smg'
      : item.variant === 'shotgun'
        ? 'shotgun'
        : item.variant === 'sniper'
          ? 'awm'
          : null;
    if (!weaponId || this.availableWeapons.has(weaponId)) return;
    this.availableWeapons.add(weaponId);
    const config = this.getWeaponConfig(weaponId);
    const state = this.weaponStates.get(weaponId);
    if (state) {
      state.magazine = config.magazineSize;
      state.reserve = Math.max(config.magazineSize, Math.floor(config.reserve * 0.45));
    }
    this.weapon.visible = true;
    this.switchWeapon(weaponId);
    this.callbacks.onToast(`已装备 ${config.name} · 获得基础弹药`);
  }

  takeAllCorpseLoot(): void {
    if (this.lootSearch) this.takeSearchedLoot();
  }

  closeCorpseLoot(): void {
    if (!this.lootSearch) return;
    this.cancelLootSearch();
    this.captureControls();
  }

  returnBackpackItemToLoot(itemId: string): void {
    const search = this.lootSearch;
    if (!search?.revealed) return;
    const backpackItem = this.run.backpack.find((item) => item.id === itemId);
    const returnsToEquipment = search.entry.source === 'corpse' && backpackItem?.equipmentSlot !== undefined;
    const equipment = search.entry.equipment ?? [];
    if (returnsToEquipment && equipment.some((item) => item.equipmentSlot === backpackItem.equipmentSlot)) {
      this.callbacks.onToast('对应装备位已有物品', 'danger');
      return;
    }
    const destination = returnsToEquipment ? equipment : search.entry.items;
    const capacity = returnsToEquipment ? 3 : search.entry.capacity;
    const transfer = transferInventoryItem(this.run.backpack, destination, itemId, capacity);
    if (!transfer.transferred) {
      this.callbacks.onToast('容器没有空位', 'danger');
      return;
    }
    this.run.backpack = transfer.source;
    if (returnsToEquipment) search.entry.equipment = transfer.destination;
    else search.entry.items = transfer.destination;
    this.callbacks.onUpdate(this.run);
    this.refreshOpenLootView('物资已放回容器');
  }

  private refreshOpenLootView(message: string): void {
    const search = this.lootSearch;
    if (!search) return;
    this.callbacks.onLootSearch({
      items: search.entry.items,
      equipment: search.entry.equipment,
      containerName: search.entry.containerName,
      phase: search.phase,
      progress: search.phase === 'searching'
        ? THREE.MathUtils.clamp((performance.now() / 1000 - search.startedAt) / search.duration, 0, 1)
        : 1,
      message,
      source: search.entry.source,
      capacity: search.entry.capacity,
      boss: search.entry.boss,
      revealedSlots: search.revealedSlots,
      justRevealedSlot: null,
    });
  }

  private cancelLootSearch(message?: string): void {
    const search = this.lootSearch;
    if (!search) {
      this.callbacks.onLootSearch(null);
      return;
    }
    if (!search.entry.opened) this.setContainerOpenProgress(search.entry.mesh, 0);
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
    if (this.nearestInteraction === 'task-item') {
      this.takeHighValueTaskItem();
      this.nearestInteraction = null;
      return;
    }
    if (this.nearestInteraction === 'task-radio') {
      this.deliverHighValueTaskItem();
      this.nearestInteraction = null;
      return;
    }
    if (this.nearestInteraction === 'checkpoint') {
      this.reservoirTunnelEntered = true;
      this.reservoirTerminalActivated = true;
      this.setMissionTerminalActive(true);
      this.syncMissionObjectiveText();
      this.callbacks.onPrompt(null);
      this.callbacks.onToast('地下主控终端已激活 · 主控芯片位置已解锁');
      this.audio.tone(760, 0.18, 0.055);
      this.nearestInteraction = null;
      return;
    }
    if (this.nearestInteraction === 'secret-reader') {
      const consumed = consumeKeyUse(this.run.backpack, ADMIN_SECRET_CARD_ID);
      if (!consumed.consumed) {
        this.callbacks.onToast('房卡不在背包中 · 可在分析处购买或搜索行政区物资点', 'danger');
        return;
      }
      this.run.backpack = consumed.items;
      this.administrationSecretUnlocked = true;
      this.administrationSecretGate = unlockShortcutGate(this.administrationSecretGate, true);
      this.setAdministrationSecretReaderActive(true);
      this.run.routeLog.push('开启行政区秘密档案室');
      this.callbacks.onUpdate(this.run);
      this.callbacks.onMiniMap(this.createMiniMapView());
      this.callbacks.onPrompt(null);
      this.callbacks.onToast(`门禁验证通过 · 二楼秘密档案室正在开启 · 卡片剩余 ${consumed.remainingUses} 次`);
      this.audio.tone(820, 0.12, 0.05);
      this.audio.tone(1040, 0.18, 0.035);
      this.nearestInteraction = null;
      return;
    }
    if (this.nearestInteraction === 'field-trader') {
      this.callbacks.onFieldMarket?.({
        visible: true,
        itemCount: this.run.backpack.filter((item) => !['weapon', 'armor', 'helmet'].includes(item.kind)).length,
        ammo: this.run.player.weapon.reserve,
        medkits: this.run.player.medkits,
        hasExtractionIntel: this.extractionIntelUnlocked,
      });
      this.nearestInteraction = null;
      return;
    }
    if (this.nearestInteraction === 'extract-condition') {
      const condition = this.operationScenario.extractionCondition;
      if (condition.type === 'pay-credits') {
        if (!this.callbacks.onSpendCredits?.(condition.requiredProgress)) {
          this.callbacks.onToast(`金币不足 · 需要 ${condition.requiredProgress} 金币`, 'danger');
          return;
        }
        this.extractionConditionProgress = advanceExtractionCondition(condition, 0, condition.requiredProgress);
        this.callbacks.onToast('通行费已支付 · 撤离通道开放');
      } else if (condition.type === 'restore-power') {
        this.extractionConditionProgress = advanceExtractionCondition(condition, 0, 1);
        this.callbacks.onToast('备用发电机已启动 · 撤离信标恢复');
        this.audio.tone(720, 0.2, 0.05);
      }
      this.nearestInteraction = null;
      this.callbacks.onMiniMap(this.createMiniMapView());
      this.emitOperationStatus();
      return;
    }
    const entry = this.nearestInteraction;
    if (!entry || typeof entry === 'string') return;
    this.startLootSearch(entry);
  }

  private takeObjective(): void {
    const sideTaskUsesObjective = ['rescue', 'plant-bomb', 'escort'].includes(this.operationScenario.task.type);
    if (!isObjectiveCarryMode(this.activeGameMode) && !sideTaskUsesObjective) return;
    if (this.run.hasObjective) return;
    if (this.activeOperation.id === 'reservoir' && !this.reservoirTerminalActivated) {
      this.callbacks.onToast('主控芯片仍被锁定 · 先激活地下主控终端', 'danger');
      return;
    }
    const aliveBossCount = this.enemies.filter((enemy) => enemy.boss && enemy.alive).length;
    if (aliveBossCount > 0) {
      this.callbacks.onToast(`任务物品被区域首领封锁 · 还需击败 ${aliveBossCount} 名 Boss`, 'danger');
      return;
    }
    if (sideTaskUsesObjective && !this.operationTaskProgress.completed) {
      this.advanceOperationTask();
      if (!isObjectiveCarryMode(this.activeGameMode)) {
        this.objectiveCase.visible = false;
        this.callbacks.onPrompt(null);
        this.callbacks.onMiniMap(this.createMiniMapView());
        return;
      }
    }
    this.run.hasObjective = true;
    this.objectiveCase.visible = false;
    if (this.activeGameMode === 'escort') {
      this.carriedObjective = true;
      this.carriedCargo.visible = true;
      this.weapon.visible = false;
      this.setAiming(false);
      this.run.objectiveText = `手持高价值货箱，前往 ${this.activeOperation.name} 撤离区`;
    } else if (this.activeGameMode === 'random-extract' && !this.extractionIntelUnlocked) {
      this.run.objectiveText = '主目标已取得 · 搜索地图情报解锁撤离坐标';
    } else {
      this.run.objectiveText = `携带任务物品，前往 ${this.activeOperation.name} 撤离区`;
    }
    this.callbacks.onPrompt(null);
    this.callbacks.onToast('主目标已回收 · 撤离点开放');
    this.audio.tone(720, 0.18, 0.055);
    this.callbacks.onMiniMap(this.createMiniMapView());
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
    this.fallbackLookActive = false;
    this.controlsActive = false;
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
    const mapOrder: MapId[] = ['harbor', 'radar', 'refinery', 'administration', 'reservoir'];
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
    this.fallbackLookActive = false;
    this.controlsActive = false;
    this.run.objectiveText = message;
    this.callbacks.onUpdate(this.run);
    this.callbacks.onDeploying(false);
    this.callbacks.onControlCapture(false);
    this.callbacks.onPrompt(null);
    this.cancelLootSearch();
    this.clearAbilities();
    this.clearAbilities();
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
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length < 0.01) return;
    let tracer = this.tracers.find((entry) => entry.life <= 0);
    if (!tracer && this.tracers.length < 48) {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.025, 1, 5, 1, true),
        new THREE.MeshBasicMaterial({ color: '#fff0a0', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      mesh.visible = false;
      this.scene.add(mesh);
      tracer = { mesh, life: 0, maxLife: 0.12 };
      this.tracers.push(tracer);
    }
    if (!tracer) tracer = this.tracers.reduce((oldest, entry) => entry.life < oldest.life ? entry : oldest);
    tracer.mesh.position.copy(start).add(end).multiplyScalar(0.5);
    tracer.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    tracer.mesh.scale.set(1, length, 1);
    (tracer.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95;
    tracer.mesh.visible = true;
    tracer.maxLife = 0.12;
    tracer.life = tracer.maxLife;
  }

  private updateTracers(delta: number): void {
    for (const tracer of this.tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= delta;
      const material = tracer.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = Math.max(0, tracer.life / tracer.maxLife) * 0.95;
      if (tracer.life <= 0) {
        tracer.life = 0;
        tracer.mesh.visible = false;
      }
    }
  }

  private disposeDynamicObject(root: THREE.Object3D): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    root.traverse((child) => {
      const renderable = child as THREE.Mesh | THREE.Points | THREE.Line | THREE.Sprite;
      if ('geometry' in renderable && renderable.geometry instanceof THREE.BufferGeometry) {
        geometries.add(renderable.geometry);
      }
      if (!('material' in renderable)) return;
      const childMaterials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
      for (const material of childMaterials) materials.add(material);
      child.userData = {};
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
      if (material instanceof THREE.ShaderMaterial) {
        for (const uniform of Object.values(material.uniforms)) {
          if (uniform?.value instanceof THREE.Texture) textures.add(uniform.value);
        }
      }
      material.dispose();
    }
    for (const texture of textures) texture.dispose();
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
    this.lastSafePlayerPosition.set(safe.x, 0.9, safe.z);
    this.camera.position.set(safe.x, 1.52, safe.z);
    this.verticalVelocity = 0;
    this.landingKick = 0;
    this.groundedBlend = 1;
    this.currentMoveSpeed = PLAYER_WALK_SPEED;
    this.crouchBlend = 0;
    this.sprintBlend = 0;
    this.motionBlend = 0;
    this.motionPhase = 0;
    this.lastStepIndex = 0;
    this.lookSwayX = 0;
    this.lookSwayY = 0;
    this.jumpQueuedUntil = 0;
    this.updateAdministrationShadowFocus(true);
  }

  private recoverPlayerFromFall(): void {
    const safe = this.lastSafePlayerPosition;
    this.playerBody.setTranslation({ x: safe.x, y: safe.y, z: safe.z }, true);
    this.playerBody.setNextKinematicTranslation({ x: safe.x, y: safe.y, z: safe.z });
    this.camera.position.set(safe.x, safe.y + this.cameraHeight, safe.z);
    this.verticalVelocity = 0;
    this.landingKick = 0;
    this.groundedBlend = 1;
    this.jumpQueuedUntil = 0;
  }

  private findNearbyClearPosition(x: number, z: number): { x: number; z: number } {
    const offsets: Array<[number, number]> = [[0, 0]];
    for (const radius of [2, 4, 6, 8, 10]) {
      for (let index = 0; index < 16; index += 1) {
        const angle = index * Math.PI / 8;
        offsets.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
      }
    }
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

  private syncMissionObjectiveText(): void {
    if (!this.run || !this.activeOperation) return;
    if (this.activeGameMode === 'training') {
      this.run.objectiveText = '射击训练场 · 移动、瞄准并练习射击';
    } else if (this.run.hasObjective) {
      this.run.objectiveText = '携带任务物品，前往标记的撤离区';
    } else {
      this.run.objectiveText = this.activeOperation.objectiveText;
    }
    this.callbacks.onUpdate(this.run);
  }
}
