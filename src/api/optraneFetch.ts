import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

function inTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Native HTTP in Tauri; browser fetch in dev web preview. */
export async function optraneFetch(input: string, init?: RequestInit): Promise<Response> {
  if (!inTauri()) return fetch(input, init);
  return tauriFetch(input, init);
}
