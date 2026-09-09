import { useEffect } from 'react';
import type { Screen } from '../types/optrane';

export function useKeyboardCommands(setScreen: (screen: Screen) => void, resetDemo: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === '1') { event.preventDefault(); setScreen('control'); }
      else if (key === '2') { event.preventDefault(); setScreen('impact'); }
      else if (key === '3') { event.preventDefault(); setScreen('recovery'); }
      else if (key === '4') { event.preventDefault(); setScreen('agents'); }
      else if (key === 'n') { event.preventDefault(); setScreen('new-production'); }
      else if (key === 'o') { event.preventDefault(); setScreen('revision'); }
      else if (event.shiftKey && key === 'r') { event.preventDefault(); resetDemo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setScreen, resetDemo]);
}
