export type GamePhase =
  | 'menu'
  | 'deploying'
  | 'active'
  | 'extracting'
  | 'success'
  | 'failed'
  | 'paused';

export type EnemyState =
  | 'patrol'
  | 'investigate'
  | 'engage'
  | 'search'
  | 'return'
  | 'dead';

export type ItemRarity = 'common' | 'rare' | 'valuable';
export type ItemKind = 'supplies' | 'electronics' | 'intel' | 'medical';

export interface InventoryItem {
  id: string;
  name: string;
  kind: ItemKind;
  rarity: ItemRarity;
  value: number;
  quantity: number;
}

export interface WeaponState {
  magazine: number;
  reserve: number;
  reloading: boolean;
  reloadEndsAt: number;
}

export interface PlayerState {
  health: number;
  armor: number;
  stamina: number;
  medkits: number;
  weapon: WeaponState;
}

export interface RunState {
  phase: GamePhase;
  player: PlayerState;
  backpack: InventoryItem[];
  hasObjective: boolean;
  kills: number;
  elapsedSeconds: number;
  extractionProgress: number;
  objectiveText: string;
}

export interface PersistentProfile {
  version: 1;
  credits: number;
  stash: InventoryItem[];
  bestTimeSeconds: number | null;
  totalExtractions: number;
  totalKills: number;
  totalRuns: number;
}

export interface ExtractionResult {
  value: number;
  grade: 'S' | 'A' | 'B' | 'C';
  timeSeconds: number;
  kills: number;
}
