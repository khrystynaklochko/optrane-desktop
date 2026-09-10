import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { Screen } from '../types/optrane';

export function useNativeMenu(setScreen: (screen: Screen) => void, resetDemo: () => void) {
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    listen<string>('optrane-menu', (event) => {
      switch (event.payload) {
        case 'new-production': setScreen('new-production'); break;
        case 'upload-revision': setScreen('revision'); break;
        case 'control': setScreen('control'); break;
        case 'impact': setScreen('impact'); break;
        case 'recovery': setScreen('recovery'); break;
        case 'agents': setScreen('agents'); break;
        case 'agent-register': setScreen('agent-register'); break;
        case 'audit': setScreen('audit'); break;
        case 'settings': setScreen('settings'); break;
        case 'reset-demo': resetDemo(); break;
      }
    }).then((fn) => { if (disposed) fn(); else cleanup = fn; }).catch(() => undefined);
    return () => { disposed = true; cleanup?.(); };
  }, [setScreen, resetDemo]);
}
