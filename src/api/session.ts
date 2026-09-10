import { fetchPairingSession, sendPairingHeartbeat, type PairingClaimResult } from './legacyPairing';
import { publicGatewayHeaders } from './gateway';
import { optraneFetch } from './optraneFetch';
import { secureAuthStorage } from './secureStorage';
import { getOptraneApiBase } from '../config/optrane';

export interface DesktopUser {
  id: string;
  email?: string;
  displayName?: string;
  emailVerified?: boolean;
}

export interface DesktopSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  user: DesktopUser;
}

const SESSION_KEY = 'desktop-session-v1';
const DEVICE_TOKEN_KEY = 'device-token-v1';
let current: DesktopSession | null = null;
let deviceToken: string | null = null;
let refreshPromise: Promise<DesktopSession> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
const sessionClearedListeners = new Set<() => void>();

export function onDesktopSessionCleared(listener: () => void): () => void {
  sessionClearedListeners.add(listener);
  return () => sessionClearedListeners.delete(listener);
}

function unwrap<T>(body: any): T {
  return body && typeof body === 'object' && 'data' in body ? body.data as T : body as T;
}

async function gatewayJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await loadDeviceToken();
  const response = await optraneFetch(`${getOptraneApiBase()}${path}`, {
    ...init,
    headers: publicGatewayHeaders({
      ...(token ? { 'X-OPTRANE-Device-Token': token } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    }),
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json() as any;
      message = body?.error?.message ?? body?.detail ?? message;
    } catch { /* keep HTTP status */ }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return unwrap<T>(await response.json());
}

function stopPairingHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startPairingHeartbeat(token: string) {
  stopPairingHeartbeat();
  heartbeatTimer = setInterval(() => {
    void sendPairingHeartbeat(token).catch(() => undefined);
  }, 5 * 60_000);
}

async function persistDeviceToken(value: string | null) {
  deviceToken = value;
  if (value) await secureAuthStorage.setItem(DEVICE_TOKEN_KEY, value);
  else await secureAuthStorage.removeItem(DEVICE_TOKEN_KEY);
}

async function persist(value: DesktopSession | null) {
  current = value;
  if (value) await secureAuthStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else await secureAuthStorage.removeItem(SESSION_KEY);
}

export async function loadDeviceToken(): Promise<string | null> {
  if (deviceToken) return deviceToken;
  const stored = await secureAuthStorage.getItem(DEVICE_TOKEN_KEY);
  deviceToken = stored?.trim() ? stored : null;
  return deviceToken;
}

export async function setLegacyPairingSession(claim: PairingClaimResult): Promise<DesktopSession> {
  await persistDeviceToken(claim.deviceToken);
  startPairingHeartbeat(claim.deviceToken);
  return setDesktopSession({
    accessToken: claim.accessToken,
    refreshToken: claim.refreshToken,
    expiresIn: claim.expiresIn,
    tokenType: claim.tokenType,
    user: claim.user,
  });
}

export async function loadDesktopSession(): Promise<DesktopSession | null> {
  if (current) return current;
  await loadDeviceToken();
  const raw = await secureAuthStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DesktopSession;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.user?.id) throw new Error('invalid session');
    current = parsed;
    if (deviceToken) startPairingHeartbeat(deviceToken);
    return parsed;
  } catch {
    await secureAuthStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export async function setDesktopSession(input: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType?: string;
  user?: DesktopUser;
}): Promise<DesktopSession> {
  const user = input.user?.id ? input.user : await gatewayJson<DesktopUser>('/auth/me', {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });
  const value: DesktopSession = {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAt: Date.now() + Math.max(30, Number(input.expiresIn || 3600)) * 1000,
    tokenType: input.tokenType ?? 'bearer',
    user,
  };
  await persist(value);
  return value;
}

export async function getDesktopSession(): Promise<DesktopSession | null> {
  return loadDesktopSession();
}

async function refreshSession(session: DesktopSession): Promise<DesktopSession> {
  const refreshed = await gatewayJson<any>('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  return setDesktopSession({
    accessToken: refreshed.accessToken ?? refreshed.access_token,
    refreshToken: refreshed.refreshToken ?? refreshed.refresh_token ?? session.refreshToken,
    expiresIn: Number(refreshed.expiresIn ?? refreshed.expires_in ?? 3600),
    tokenType: refreshed.tokenType ?? refreshed.token_type,
    user: session.user,
  });
}

export async function ensureAccessToken(): Promise<string> {
  const session = await loadDesktopSession();
  if (!session) throw new Error('No OPTRANE desktop session. Verify your account on the OPTRANE website.');
  // Refresh through OPTRANE, never directly against the identity provider.
  if (session.expiresAt - Date.now() > 90_000) return session.accessToken;
  if (!refreshPromise) refreshPromise = refreshSession(session).finally(() => { refreshPromise = null; });
  return (await refreshPromise).accessToken;
}

export async function refreshDesktopSession(): Promise<DesktopSession> {
  const session = await loadDesktopSession();
  if (!session) throw new Error('No OPTRANE desktop session.');
  if (!refreshPromise) refreshPromise = refreshSession(session).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function clearDesktopSession(): Promise<void> {
  stopPairingHeartbeat();
  await persistDeviceToken(null);
  await persist(null);
  sessionClearedListeners.forEach((listener) => listener());
}

export async function signOutDesktop(): Promise<void> {
  const session = await loadDesktopSession();
  if (session) {
    try {
      await gatewayJson<void>('/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.accessToken}` },
        body: '{}',
      });
    } catch { /* local revocation is still mandatory */ }
  }
  await clearDesktopSession();
}

async function refreshLegacyPairingSession(stored: DesktopSession, token: string): Promise<DesktopSession | null> {
  try {
    const refreshed = await fetchPairingSession(token);
    if (refreshed.accessToken && refreshed.refreshToken) {
      return setDesktopSession({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresIn: refreshed.expiresIn ?? 3600,
        tokenType: refreshed.tokenType,
        user: refreshed.user ?? stored.user,
      });
    }
  } catch { /* fall through to bearer refresh */ }
  return null;
}

export async function validateDesktopSession(): Promise<DesktopSession | null> {
  const session = await loadDesktopSession();
  if (!session) return null;
  const token = await loadDeviceToken();
  if (token) {
    const legacy = await refreshLegacyPairingSession(session, token);
    if (legacy) return legacy;
  }
  try {
    const accessToken = await ensureAccessToken();
    const user = await gatewayJson<DesktopUser>('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } });
    const validated = { ...(await loadDesktopSession())!, user };
    await persist(validated);
    return validated;
  } catch {
    await clearDesktopSession();
    return null;
  }
}
