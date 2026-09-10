import { exchangePairingToken, fetchPairingSession, sendPairingHeartbeat, type PairingClaimResult } from './legacyPairing';
import { publicGatewayHeaders } from './gateway';
import { optraneFetch } from './optraneFetch';
import { secureAuthStorage } from './secureStorage';
import {
  getOptraneApiBase,
  OPTRANE_GATEWAY_PUBLISHABLE_KEY,
  OPTRANE_SUPABASE_URL,
} from '../config/optrane';

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
const PENDING_PAIRING_KEY = 'pending-pairing-v1';

export interface PendingPairing {
  deviceToken: string;
  user?: DesktopUser;
  claimedAt: number;
}
let current: DesktopSession | null = null;
let deviceToken: string | null = null;
let refreshPromise: Promise<DesktopSession> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let sessionRefreshTimer: ReturnType<typeof setInterval> | null = null;
const sessionClearedListeners = new Set<() => void>();
const SESSION_REFRESH_LEAD_MS = 5 * 60_000;

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

function stopSessionRefresh() {
  if (sessionRefreshTimer) {
    clearInterval(sessionRefreshTimer);
    sessionRefreshTimer = null;
  }
}

function startSessionRefresh() {
  stopSessionRefresh();
  sessionRefreshTimer = setInterval(() => {
    void (async () => {
      const session = await loadDesktopSession();
      const token = await loadDeviceToken();
      if (!session || !token) return;
      if (session.expiresAt - Date.now() > SESSION_REFRESH_LEAD_MS) return;
      try {
        await refreshSessionFromDeviceToken(session, token);
      } catch { /* keep current session until explicit disconnect */ }
    })();
  }, 60_000);
}

function startPairingHeartbeat(token: string) {
  stopPairingHeartbeat();
  heartbeatTimer = setInterval(() => {
    void sendPairingHeartbeat(token).catch(() => undefined);
  }, 5 * 60_000);
  startSessionRefresh();
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

export async function savePendingPairing(input: { deviceToken: string; user?: DesktopUser }): Promise<void> {
  const value: PendingPairing = {
    deviceToken: input.deviceToken,
    user: input.user,
    claimedAt: Date.now(),
  };
  await secureAuthStorage.setItem(PENDING_PAIRING_KEY, JSON.stringify(value));
  await persistDeviceToken(input.deviceToken);
}

export async function loadPendingPairing(): Promise<PendingPairing | null> {
  const raw = await secureAuthStorage.getItem(PENDING_PAIRING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingPairing;
    if (!parsed.deviceToken) throw new Error('invalid pending pairing');
    return parsed;
  } catch {
    await secureAuthStorage.removeItem(PENDING_PAIRING_KEY);
    return null;
  }
}

export async function clearPendingPairing(): Promise<void> {
  await secureAuthStorage.removeItem(PENDING_PAIRING_KEY);
}

export async function setLegacyPairingSession(claim: PairingClaimResult): Promise<DesktopSession> {
  await clearPendingPairing();
  await persistDeviceToken(claim.deviceToken);
  startPairingHeartbeat(claim.deviceToken);
  if (claim.user?.id && claim.accessToken && claim.refreshToken) {
    current = {
      accessToken: claim.accessToken,
      refreshToken: claim.refreshToken,
      expiresAt: Date.now() + Math.max(30, Number(claim.expiresIn || 3600)) * 1000,
      tokenType: claim.tokenType ?? 'bearer',
      user: claim.user,
    };
  }
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

function normalizeGatewayUser(value: unknown): DesktopUser | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const id = record.id ?? record.userId ?? record.user_id;
  if (typeof id !== 'string') return undefined;
  return {
    id,
    email: typeof record.email === 'string' ? record.email : undefined,
    displayName: typeof record.displayName === 'string'
      ? record.displayName
      : typeof record.display_name === 'string'
        ? record.display_name
        : undefined,
    emailVerified: Boolean(record.emailVerified ?? record.email_verified),
  };
}

async function refreshSessionFromDeviceToken(session: DesktopSession, deviceToken: string): Promise<DesktopSession> {
  const exchanged = await exchangePairingToken(deviceToken, session.user);
  return setDesktopSession({
    accessToken: exchanged.accessToken,
    refreshToken: exchanged.refreshToken,
    expiresIn: exchanged.expiresIn,
    tokenType: exchanged.tokenType,
    user: exchanged.user ?? session.user,
  });
}

async function refreshSupabaseSession(session: DesktopSession): Promise<DesktopSession> {
  const response = await optraneFetch(`${OPTRANE_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: OPTRANE_GATEWAY_PUBLISHABLE_KEY,
      Authorization: `Bearer ${OPTRANE_GATEWAY_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });
  if (!response.ok) {
    let message = 'Could not refresh the OPTRANE session.';
    try {
      const body = await response.json() as { error_description?: string; msg?: string; error?: string };
      message = body.error_description ?? body.msg ?? body.error ?? message;
    } catch { /* keep default */ }
    throw new Error(message);
  }
  const body = await response.json() as Record<string, unknown>;
  const accessToken = body.access_token;
  const refreshToken = body.refresh_token;
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    throw new Error('Supabase did not return a refreshed desktop session.');
  }
  const user = body.user && typeof body.user === 'object'
    ? normalizeGatewayUser(body.user)
    : session.user;
  return setDesktopSession({
    accessToken,
    refreshToken,
    expiresIn: Number(body.expires_in ?? 3600),
    tokenType: typeof body.token_type === 'string' ? body.token_type : session.tokenType,
    user,
  });
}

export async function setDesktopSession(input: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType?: string;
  user?: DesktopUser;
}): Promise<DesktopSession> {
  if (!input.accessToken?.trim() || !input.refreshToken?.trim()) {
    throw new Error('OPTRANE did not receive valid session credentials. Finish pairing with your website password.');
  }
  let user: DesktopUser | undefined;
  try {
    user = await gatewayJson<DesktopUser>('/auth/me', {
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });
  } catch {
    throw new Error('Your OPTRANE account session is not authenticated for API calls. Disconnect, then pair again with your website password.');
  }
  if (!user?.id) throw new Error('OPTRANE did not receive a valid account identity for this desktop session.');
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
  const deviceToken = await loadDeviceToken();
  if (deviceToken) {
    try {
      return await refreshSessionFromDeviceToken(session, deviceToken);
    } catch { /* fall through */ }
  }
  try {
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
  } catch {
    return refreshSupabaseSession(session);
  }
}

export async function ensureAccessToken(): Promise<string> {
  const session = await loadDesktopSession();
  if (!session) throw new Error('No OPTRANE desktop session. Verify your account on the OPTRANE website.');
  if (session.expiresAt - Date.now() > SESSION_REFRESH_LEAD_MS) return session.accessToken;
  if (!refreshPromise) refreshPromise = refreshSession(session).finally(() => { refreshPromise = null; });
  try {
    return (await refreshPromise).accessToken;
  } catch {
    const deviceToken = await loadDeviceToken();
    if (deviceToken) {
      try {
        return (await refreshSessionFromDeviceToken(session, deviceToken)).accessToken;
      } catch { /* fall through */ }
    }
    if (session.expiresAt > Date.now()) return session.accessToken;
    throw new Error('OPTRANE session expired. Use Disconnect, then pair again from the login screen.');
  }
}

export async function refreshDesktopSession(): Promise<DesktopSession> {
  const session = await loadDesktopSession();
  if (!session) throw new Error('No OPTRANE desktop session.');
  if (!refreshPromise) refreshPromise = refreshSession(session).finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function clearDesktopSession(): Promise<void> {
  stopPairingHeartbeat();
  stopSessionRefresh();
  await clearPendingPairing();
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
    return await refreshSessionFromDeviceToken(stored, token);
  } catch {
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
  }
  return null;
}

export async function validateDesktopSession(): Promise<DesktopSession | null> {
  let session = await loadDesktopSession();
  const token = await loadDeviceToken();

  if (!session && token) {
    const pending = await loadPendingPairing();
    const userHint = pending?.user;
    try {
      const exchanged = await exchangePairingToken(token, userHint);
      return setLegacyPairingSession(exchanged);
    } catch { /* fall through */ }
    try {
      const refreshed = await fetchPairingSession(token);
      if (refreshed.accessToken && refreshed.refreshToken) {
        return setLegacyPairingSession({
          deviceToken: token,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresIn: refreshed.expiresIn ?? 3600,
          tokenType: refreshed.tokenType,
          user: refreshed.user ?? userHint,
        });
      }
    } catch { /* fall through */ }
    return null;
  }

  if (!session) return null;

  if (session.expiresAt - Date.now() > SESSION_REFRESH_LEAD_MS && session.user?.id) {
    try {
      await gatewayJson<DesktopUser>('/auth/me', {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      return session;
    } catch { /* refresh below */ }
  }

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
    return (await loadDesktopSession()) ?? session;
  }
}
