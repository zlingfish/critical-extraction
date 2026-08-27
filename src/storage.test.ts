import { describe, expect, it } from 'vitest';
import { readStoredValue, writeStoredValue, type StorageLike } from './storage';

describe('safe browser storage', () => {
  it('reads and writes when storage is available', () => {
    const values = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
    };

    expect(writeStoredValue('profile', '{"credits":100}', storage)).toBe(true);
    expect(readStoredValue('profile', storage)).toEqual({ value: '{"credits":100}', available: true });
  });

  it('keeps the game running when browser storage is blocked', () => {
    const blocked: StorageLike = {
      getItem: () => { throw new DOMException('blocked', 'SecurityError'); },
      setItem: () => { throw new DOMException('blocked', 'SecurityError'); },
    };

    expect(readStoredValue('profile', blocked)).toEqual({ value: null, available: false });
    expect(writeStoredValue('profile', '{}', blocked)).toBe(false);
  });

  it('handles browsers without local storage', () => {
    expect(readStoredValue('profile', null)).toEqual({ value: null, available: false });
    expect(writeStoredValue('profile', '{}', null)).toBe(false);
  });
});
