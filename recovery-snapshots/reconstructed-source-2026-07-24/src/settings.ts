import { writeStoredValue } from './storage';

export const SETTINGS_KEY = 'critical-extraction.settings.v1';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export type GameAction =
  | 'forward' | 'backward' | 'left' | 'right' | 'sprint' | 'crouch' | 'jump'
  | 'interact' | 'reload' | 'aim' | 'heal' | 'inventory' | 'weapon1' | 'weapon2' | 'weapon3'
  | 'weapon4' | 'weapon5' | 'weapon6' | 'inspect' | 'smoke' | 'adrenaline' | 'run';

export interface GameSettings {
  version: 1;
  mouseSensitivity: number;
  trackpadSensitivity: number;
  fieldOfView: number;
  volume: number;
  quality: QualityLevel;
  crosshairColor: string;
  crosshairSize: number;
  crosshairOpacity: number;
  keyBindings: Record<GameAction, string>;
}

export const DEFAULT_KEY_BINDINGS: Record<GameAction, string> = {
  forward: 'KeyW', backward: 'KeyS', left: 'KeyA', right: 'KeyD',
  sprint: 'ShiftLeft', crouch: 'KeyC', jump: 'Space', interact: 'KeyE',
  reload: 'KeyX', aim: 'MouseRight', heal: 'KeyH', inventory: 'Tab', weapon1: 'Digit1', weapon2: 'Digit2',
  weapon3: 'Digit3', weapon4: 'Digit4', weapon5: 'Digit5', weapon6: 'Digit6', inspect: 'KeyI',
  smoke: 'KeyG', adrenaline: 'KeyV', run: 'KeyR',
};

export const DEFAULT_SETTINGS: GameSettings = {
  version: 1,
  mouseSensitivity: 1,
  trackpadSensitivity: 1,
  fieldOfView: 74,
  volume: 0.65,
  quality: 'medium',
  crosshairColor: '#f4f7f0',
  crosshairSize: 28,
  crosshairOpacity: 0.9,
  keyBindings: { ...DEFAULT_KEY_BINDINGS },
};

const QUALITY_LEVELS: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
const ACTIONS = Object.keys(DEFAULT_KEY_BINDINGS) as GameAction[];

function numberOr(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function createDefaultSettings(): GameSettings {
  return { ...DEFAULT_SETTINGS, keyBindings: { ...DEFAULT_KEY_BINDINGS } };
}

export function parseSettings(raw: string | null): GameSettings {
  if (!raw) return createDefaultSettings();
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.version !== 1 || !value.keyBindings || typeof value.keyBindings !== 'object') {
      return createDefaultSettings();
    }
    const savedBindings = value.keyBindings as Record<string, unknown>;
    const keyBindings = { ...DEFAULT_KEY_BINDINGS };
    for (const action of ACTIONS) {
      if (typeof savedBindings[action] === 'string' && savedBindings[action].length > 0) {
        keyBindings[action] = savedBindings[action];
      }
    }
    // Older saves used R for reload; reserve it for the new quick-run action.
    if (!savedBindings.run && savedBindings.reload === 'KeyR') keyBindings.reload = 'KeyX';
    return {
      version: 1,
      mouseSensitivity: numberOr(value.mouseSensitivity, DEFAULT_SETTINGS.mouseSensitivity, 0.2, 3),
      trackpadSensitivity: numberOr(value.trackpadSensitivity, DEFAULT_SETTINGS.trackpadSensitivity, 0.2, 3),
      fieldOfView: numberOr(value.fieldOfView, DEFAULT_SETTINGS.fieldOfView, 60, 100),
      volume: numberOr(value.volume, DEFAULT_SETTINGS.volume, 0, 1),
      quality: QUALITY_LEVELS.includes(value.quality as QualityLevel) ? value.quality as QualityLevel : DEFAULT_SETTINGS.quality,
      crosshairColor: typeof value.crosshairColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.crosshairColor) ? value.crosshairColor : DEFAULT_SETTINGS.crosshairColor,
      crosshairSize: numberOr(value.crosshairSize, DEFAULT_SETTINGS.crosshairSize, 16, 46),
      crosshairOpacity: numberOr(value.crosshairOpacity, DEFAULT_SETTINGS.crosshairOpacity, 0.2, 1),
      keyBindings,
    };
  } catch {
    return createDefaultSettings();
  }
}

export function saveSettings(settings: GameSettings): boolean {
  return writeStoredValue(SETTINGS_KEY, JSON.stringify(settings));
}

export function keyLabel(code: string): string {
  const labels: Record<string, string> = {
    Space: '空格', ShiftLeft: '左 Shift', ShiftRight: '右 Shift', ControlLeft: '左 Ctrl',
    ControlRight: '右 Ctrl', AltLeft: '左 Alt', AltRight: '右 Alt', Tab: 'Tab', Escape: 'Esc',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', MouseRight: '鼠标右键',
  };
  if (labels[code]) return labels[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

export const SETTINGS_ACTION_LABELS: Record<GameAction, string> = {
  forward: '向前移动', backward: '向后移动', left: '向左移动', right: '向右移动',
  sprint: '冲刺', crouch: '蹲伏', jump: '跳跃', interact: '互动 / 搜刮', reload: '换弹',
  aim: '瞄准', heal: '使用医疗包', inventory: '打开背包', weapon1: '武器 1', weapon2: '武器 2', weapon3: '武器 3',
  weapon4: '武器 4', weapon5: '武器 5', weapon6: '武器 6', inspect: '检视武器',
  smoke: '投放烟幕', adrenaline: '使用肾上腺素', run: '快速冲刺',
};
