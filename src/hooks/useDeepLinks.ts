import { useEffect } from 'react';
import * as deepLink from '@tauri-apps/plugin-deep-link';
import type { Screen } from '../types/optrane';

interface DeepLinkModule {
  getCurrent?: () => Promise<string[] | null>;
  onOpenUrl: (callback: (urls: string[]) => void) => Promise<() => void>;
}

export function useDeepLinks(onNavigate: (screen: Screen, productionId?: string, analysisId?: string, agentId?: string) => void) {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const module = deepLink as unknown as DeepLinkModule;
    const handle = (urls: string[]) => {
      const raw = urls[0];
      if (!raw) return;
      try {
        const url = new URL(raw);
        if (url.protocol !== 'optrane:') return;
        const parts = [url.hostname, ...url.pathname.split('/').filter(Boolean)];
        if (parts[0] !== 'production' || !parts[1]) return;
        const productionId = parts[1];
        if (parts[2] === 'revision') onNavigate('revision', productionId);
        else if (parts[2] === 'impact') onNavigate('impact', productionId, parts[3]);
        else if (parts[2] === 'audit') onNavigate('audit', productionId);
        else if (parts[2] === 'agent' && parts[3]) onNavigate('agent-detail', productionId, undefined, parts[3]);
        else if (parts[2] === 'agents') onNavigate('agents', productionId);
        else onNavigate('control', productionId);
      } catch { /* invalid deep link */ }
    };
    module.getCurrent?.().then((urls) => urls && handle(urls)).catch(() => undefined);
    module.onOpenUrl(handle).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
  }, [onNavigate]);
}
