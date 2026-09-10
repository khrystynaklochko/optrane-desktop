import { openUrl } from '@tauri-apps/plugin-opener';
import { getVersion } from '@tauri-apps/api/app';
import { publicGatewayJson } from './gateway';
import { setDesktopSession } from './session';
import { OPTRANE_DESKTOP_CALLBACK, OPTRANE_DESKTOP_VERIFY_URL } from '../config/optrane';

export interface DesktopAuthStart {
  requestId: string;
  verifier: string;
  verificationUrl: string;
  expiresAt: string;
}

interface DesktopAuthExchange {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType?: string;
  user?: { id: string; email?: string };
}

const storageKey = 'optrane.desktop.verification';

function inTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function appVersion() {
  if (!inTauri()) return 'web-dev';
  try { return await getVersion(); } catch { return 'unknown'; }
}

export async function startWebsiteVerification(): Promise<DesktopAuthStart> {
  const value = await publicGatewayJson<any>('/desktop-auth/start', {
    method: 'POST',
    body: JSON.stringify({
      callbackUri: OPTRANE_DESKTOP_CALLBACK,
      callback_uri: OPTRANE_DESKTOP_CALLBACK,
      client: 'OPTRANE Command',
      deviceName: navigator.platform || 'OPTRANE Desktop',
      platform: navigator.userAgent,
      appVersion: await appVersion(),
    }),
  });
  const result: DesktopAuthStart = {
    requestId: value.requestId ?? value.request_id,
    verifier: value.verifier,
    verificationUrl: value.verificationUrl ?? value.verification_url ?? `${OPTRANE_DESKTOP_VERIFY_URL}?request_id=${encodeURIComponent(value.requestId ?? value.request_id)}`,
    expiresAt: value.expiresAt ?? value.expires_at,
  };
  if (!result.requestId || !result.verifier) throw new Error('OPTRANE website did not return a desktop verification request.');
  sessionStorage.setItem(storageKey, JSON.stringify(result));
  if (inTauri()) await openUrl(result.verificationUrl);
  else window.open(result.verificationUrl, '_blank', 'noopener,noreferrer');
  return result;
}

export function pendingWebsiteVerification(): DesktopAuthStart | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) as DesktopAuthStart : null;
  } catch { return null; }
}

/**
 * Exchanges only the one-time desktop verifier with the OPTRANE gateway.
 * The deep-link URL contains no Supabase access/refresh token and no provider token.
 * The gateway consumes its server-held Supabase one-time login token and returns a
 * normal user session exactly once.
 */
export async function completeWebsiteVerification(requestId?: string): Promise<void> {
  const pending = pendingWebsiteVerification();
  if (!pending) throw new Error('No pending OPTRANE website verification exists on this device.');
  if (requestId && requestId !== pending.requestId) throw new Error('The verification response does not match this OPTRANE desktop request.');

  const status = await checkWebsiteVerification();
  if (status === 'PENDING' || status === 'UNKNOWN') {
    throw new Error('Website verification is not approved yet. Sign in on the OPTRANE website and click “Verify OPTRANE Command”, then return here.');
  }
  if (status === 'EXPIRED') throw new Error('This pairing request expired. Start again from OPTRANE Command.');

  const exchange = await publicGatewayJson<any>('/desktop-auth/exchange', {
    method: 'POST',
    body: JSON.stringify({
      requestId: pending.requestId,
      request_id: pending.requestId,
      verifier: pending.verifier,
    }),
  });
  const normalized: DesktopAuthExchange = {
    accessToken: exchange.accessToken ?? exchange.access_token,
    refreshToken: exchange.refreshToken ?? exchange.refresh_token,
    expiresIn: Number(exchange.expiresIn ?? exchange.expires_in ?? 3600),
    tokenType: exchange.tokenType ?? exchange.token_type,
    user: exchange.user,
  };
  if (!normalized.accessToken || !normalized.refreshToken) throw new Error('OPTRANE did not return a verified desktop user session.');
  await setDesktopSession({
    accessToken: normalized.accessToken,
    refreshToken: normalized.refreshToken,
    expiresIn: normalized.expiresIn,
    tokenType: normalized.tokenType,
    user: normalized.user,
  });
  sessionStorage.removeItem(storageKey);
}

export async function checkWebsiteVerification(): Promise<string> {
  const pending = pendingWebsiteVerification();
  if (!pending) return 'NONE';
  const params = new URLSearchParams({ verifier: pending.verifier });
  const status = await publicGatewayJson<any>(`/desktop-auth/${encodeURIComponent(pending.requestId)}/status?${params}`);
  return String(status.status ?? 'UNKNOWN');
}

export async function cancelWebsiteVerification() {
  sessionStorage.removeItem(storageKey);
}
