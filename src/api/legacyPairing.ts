import { getVersion } from '@tauri-apps/api/app';
import { publicGatewayHeaders, readGatewayError } from './gateway';
import {
  getOptraneApiBase,
  OPTRANE_GATEWAY_PUBLISHABLE_KEY,
  OPTRANE_SUPABASE_URL,
  OPTRANE_WEB_BASE,
} from '../config/optrane';
import type { DesktopUser } from './session';

export interface PairingClaimResult {
  deviceToken: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType?: string;
  user?: DesktopUser;
}

function unwrap<T>(body: unknown): T {
  return body && typeof body === 'object' && 'data' in body
    ? (body as { data: T }).data
    : body as T;
}

function inTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function appVersion() {
  if (!inTauri()) return 'web-dev';
  try { return await getVersion(); } catch { return 'unknown'; }
}

export function sanitizePairingCodeInput(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9);
}

export function formatPairingCodeInput(raw: string): string {
  const compact = sanitizePairingCodeInput(raw).replace(/-/g, '').slice(0, 8);
  if (compact.length <= 4) return compact;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

export function normalizePairingCode(raw: string): string {
  const compact = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.length !== 8) {
    throw new Error('Enter the pairing code shown on the OPTRANE website (format XXXX-XXXX).');
  }
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

export function isCompletePairingCode(raw: string): boolean {
  const formatted = formatPairingCodeInput(raw);
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(formatted);
}

function normalizeUser(value: unknown): DesktopUser | undefined {
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

function readTokens(record: Record<string, unknown>) {
  const session = record.session && typeof record.session === 'object'
    ? record.session as Record<string, unknown>
    : undefined;
  const accessToken = record.accessToken
    ?? record.access_token
    ?? session?.accessToken
    ?? session?.access_token;
  const refreshToken = record.refreshToken
    ?? record.refresh_token
    ?? session?.refreshToken
    ?? session?.refresh_token;
  return {
    accessToken: typeof accessToken === 'string' ? accessToken : undefined,
    refreshToken: typeof refreshToken === 'string' ? refreshToken : undefined,
    expiresIn: Number(record.expiresIn ?? record.expires_in ?? session?.expires_in ?? session?.expiresIn ?? 3600),
    tokenType: typeof record.tokenType === 'string'
      ? record.tokenType
      : typeof record.token_type === 'string'
        ? record.token_type
        : undefined,
  };
}

function normalizeClaim(value: unknown, userHint?: DesktopUser): Omit<PairingClaimResult, 'accessToken' | 'refreshToken'> & Partial<Pick<PairingClaimResult, 'accessToken' | 'refreshToken'>> {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const deviceToken = record.deviceToken ?? record.device_token;
  if (typeof deviceToken !== 'string' || !deviceToken) {
    throw new Error('The gateway did not return a device token for this pairing code.');
  }
  const tokens = readTokens(record);
  return {
    deviceToken,
    ...tokens,
    user: normalizeUser(record.user) ?? userHint,
  };
}

function normalizeSessionRefresh(value: unknown): Partial<PairingClaimResult> {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const tokens = readTokens(record);
  return {
    ...tokens,
    user: normalizeUser(record.user),
  };
}

async function legacyJson<T>(path: string, init?: RequestInit, deviceToken?: string): Promise<T> {
  const response = await fetch(`${getOptraneApiBase()}${path}`, {
    ...init,
    headers: publicGatewayHeaders({
      ...(deviceToken ? { 'X-OPTRANE-Device-Token': deviceToken } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    }),
  });
  if (!response.ok) throw new Error(await readGatewayError(response));
  if (response.status === 204) return undefined as T;
  return unwrap<T>(await response.json());
}

export async function signInWithSupabasePassword(email: string, password: string): Promise<Pick<PairingClaimResult, 'accessToken' | 'refreshToken' | 'expiresIn' | 'tokenType' | 'user'>> {
  const response = await fetch(`${OPTRANE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: OPTRANE_GATEWAY_PUBLISHABLE_KEY,
      Authorization: `Bearer ${OPTRANE_GATEWAY_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    let message = 'Could not sign in with your OPTRANE website password.';
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
    throw new Error('Supabase did not return a desktop session for this account.');
  }
  const user = body.user && typeof body.user === 'object'
    ? normalizeUser(body.user)
    : undefined;
  return {
    accessToken,
    refreshToken,
    expiresIn: Number(body.expires_in ?? 3600),
    tokenType: typeof body.token_type === 'string' ? body.token_type : 'bearer',
    user,
  };
}

async function resolveLegacySession(claim: Omit<PairingClaimResult, 'accessToken' | 'refreshToken'> & Partial<Pick<PairingClaimResult, 'accessToken' | 'refreshToken'>>, password: string): Promise<PairingClaimResult> {
  if (claim.accessToken && claim.refreshToken) {
    return claim as PairingClaimResult;
  }
  const email = claim.user?.email;
  if (!email) {
    throw new Error('The gateway paired this device but did not return an account email. Generate a new pairing code on the OPTRANE website.');
  }
  const session = await signInWithSupabasePassword(email, password);
  return {
    deviceToken: claim.deviceToken,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresIn: session.expiresIn,
    tokenType: session.tokenType,
    user: session.user ?? claim.user,
  };
}

export async function claimPairingCode(code: string, password: string): Promise<PairingClaimResult> {
  const normalized = normalizePairingCode(code);
  const value = await legacyJson<unknown>('/pairing/claim', {
    method: 'POST',
    body: JSON.stringify({
      code: normalized,
      deviceName: navigator.platform || 'OPTRANE Command',
      platform: navigator.userAgent,
      appVersion: await appVersion(),
      client: 'OPTRANE Command',
    }),
  });
  const claim = normalizeClaim(value);
  return resolveLegacySession(claim, password);
}

export async function fetchPairingSession(deviceToken: string): Promise<Partial<PairingClaimResult>> {
  const value = await legacyJson<unknown>('/pairing/session', { method: 'GET' }, deviceToken);
  return normalizeSessionRefresh(value);
}

export async function sendPairingHeartbeat(deviceToken: string): Promise<void> {
  await legacyJson<void>('/pairing/heartbeat', { method: 'POST', body: '{}' }, deviceToken);
}

export const LEGACY_PAIRING_WEBSITE = OPTRANE_WEB_BASE;
