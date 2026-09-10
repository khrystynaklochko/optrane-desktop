import { useCallback } from 'react';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

export function useNotifications() {
  return useCallback(async (title: string, body: string) => {
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === 'granted';
      if (granted) sendNotification({ title, body });
    } catch {
      // Browser preview or OS notification integration unavailable.
    }
  }, []);
}
