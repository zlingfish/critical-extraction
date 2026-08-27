export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StorageReadResult {
  value: string | null;
  available: boolean;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredValue(key: string, storage: StorageLike | null = browserStorage()): StorageReadResult {
  if (!storage) return { value: null, available: false };
  try {
    return { value: storage.getItem(key), available: true };
  } catch {
    return { value: null, available: false };
  }
}

export function writeStoredValue(
  key: string,
  value: string,
  storage: StorageLike | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
