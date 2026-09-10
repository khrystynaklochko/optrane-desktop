import { invoke } from '@tauri-apps/api/core';

const prefix = 'optrane.secure.';

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function durableGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function durableSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn('OPTRANE durable storage write failed.', error);
  }
}

function durableRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch { /* optional */ }
}

export const secureAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    const namespaced = `${prefix}${key}`;
    if (!inTauri()) return durableGet(namespaced);

    try {
      const fromKeychain = await invoke<string | null>('credential_get', { key: namespaced });
      if (fromKeychain?.trim()) return fromKeychain;
    } catch (error) {
      console.warn('OPTRANE keychain read failed; using durable fallback.', error);
    }
    return durableGet(namespaced);
  },
  async setItem(key: string, value: string): Promise<void> {
    const namespaced = `${prefix}${key}`;
    durableSet(namespaced, value);
    if (!inTauri()) return;
    try {
      await invoke('credential_set', { key: namespaced, value });
    } catch (error) {
      console.warn('OPTRANE keychain write failed; kept durable local fallback.', error);
    }
  },
  async removeItem(key: string): Promise<void> {
    const namespaced = `${prefix}${key}`;
    durableRemove(namespaced);
    if (!inTauri()) return;
    try { await invoke('credential_delete', { key: namespaced }); }
    catch (error) { console.warn('OPTRANE keychain delete failed.', error); }
  },
};
