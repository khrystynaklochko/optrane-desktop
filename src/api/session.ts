import { secureAuthStorage } from './secureStorage';
import { OPTRANE_API_BASE } from '../config/optrane';

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
let current: DesktopSession | null = null;
let refreshPromise: Promise<DesktopSession> | null = null;

function unwrap<T>(body: any): T {
  return body && typeof body === 'object' && 'data' in body ? body.data as T : body as T;
}

async function gatewayJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${OPTRANE_API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-optrane-client': 'desktop',
      ...init?.headers,
    },
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

async function persist(value: DesktopSession | null) {
  current = value;
  if (value) await secureAuthStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else await secureAuthStorage.removeItem(SESSION_KEY);
}

export async function loadDesktopSession(): Promise<DesktopSession | null> {
  if (current) return current;
  const raw = await secureAuthStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DesktopSession;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.user?.id) throw new Error('invalid session');
    current = parsed;
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
  await persist(null);
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

export async function validateDesktopSession(): Promise<DesktopSession | null> {
  const session = await loadDesktopSession();
  if (!session) return null;
  try {
    const token = await ensureAccessToken();
    const user = await gatewayJson<DesktopUser>('/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    const validated = { ...(await loadDesktopSession())!, user };
    await persist(validated);
    return validated;
  } catch {
    await clearDesktopSession();
    return null;
  }
}
