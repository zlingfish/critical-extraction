import { describe, expect, it } from 'vitest';
import { createDefaultSettings, parseSettings } from './settings';

describe('game settings', () => {
  it('uses defaults when settings are missing or damaged', () => {
    expect(parseSettings(null)).toEqual(createDefaultSettings());
    expect(parseSettings('{broken')).toEqual(createDefaultSettings());
  });

  it('uses defaults for unsupported versions', () => {
    expect(parseSettings(JSON.stringify({ version: 0 }))).toEqual(createDefaultSettings());
  });

  it('clamps unsafe numeric values', () => {
    const settings = createDefaultSettings();
    const restored = parseSettings(JSON.stringify({
      ...settings,
      mouseSensitivity: 99,
      trackpadSensitivity: -2,
      fieldOfView: 180,
      volume: -1,
      crosshairSize: 100,
      crosshairOpacity: 0,
    }));
    expect(restored.mouseSensitivity).toBe(3);
    expect(restored.trackpadSensitivity).toBe(0.2);
    expect(restored.fieldOfView).toBe(100);
    expect(restored.volume).toBe(0);
    expect(restored.crosshairSize).toBe(46);
    expect(restored.crosshairOpacity).toBe(0.2);
  });

  it('restores saved key bindings and repairs missing actions', () => {
    const settings = createDefaultSettings();
    const restored = parseSettings(JSON.stringify({
      ...settings,
      keyBindings: { forward: 'ArrowUp', interact: 'KeyF' },
    }));
    expect(restored.keyBindings.forward).toBe('ArrowUp');
    expect(restored.keyBindings.interact).toBe('KeyF');
    expect(restored.keyBindings.backward).toBe('KeyS');
    expect(restored.keyBindings.inventory).toBe('Tab');
    expect(restored.keyBindings.smoke).toBe('KeyG');
    expect(restored.keyBindings.adrenaline).toBe('KeyV');
  });
});
