import { invoke } from '@tauri-apps/api/core';

const prefix = 'optrane.secure.';

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export const secureAuthStorage = {
  async getItem(key: string): Promise<string | null> {
    const namespaced = `${prefix}${key}`;
    if (!inTauri()) return sessionStorage.getItem(namespaced);
    try {
      return await invoke<string | null>('credential_get', { key: namespaced });
    } catch (error) {
      console.warn('OPTRANE secure storage read failed; using session-only fallback.', error);
      return sessionStorage.getItem(namespaced);
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    const namespaced = `${prefix}${key}`;
    if (!inTauri()) {
      sessionStorage.setItem(namespaced, value);
      return;
    }
    try {
      await invoke('credential_set', { key: namespaced, value });
      sessionStorage.removeItem(namespaced);
    } catch (error) {
      console.warn('OPTRANE secure storage write failed; using session-only fallback.', error);
      sessionStorage.setItem(namespaced, value);
    }
  },
  async removeItem(key: string): Promise<void> {
    const namespaced = `${prefix}${key}`;
    sessionStorage.removeItem(namespaced);
    if (!inTauri()) {
      sessionStorage.removeItem(namespaced);
      return;
    }
    try { await invoke('credential_delete', { key: namespaced }); }
    catch (error) { console.warn('OPTRANE secure storage delete failed.', error); }
  },
};
