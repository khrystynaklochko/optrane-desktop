import { getVersion } from '@tauri-apps/api/app';
import { publicGatewayHeaders, readGatewayError } from './gateway';
import { optraneFetch } from './optraneFetch';
import {
  getOptraneApiBase,
  OPTRANE_GATEWAY_PUBLISHABLE_KEY,
  OPTRANE_SUPABASE_URL,
  OPTRANE_WEB_BASE,
} from '../config/optrane';
import {
  loadPendingPairing,
  savePendingPairing,
  type DesktopUser,
} from './session';

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

export function compactPairingCode(raw: string): string {
  const compact = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.length !== 8) {
    throw new Error('Enter the pairing code shown on the OPTRANE website (format XXXX-XXXX).');
  }
  return compact;
}

export function normalizePairingCode(raw: string): string {
  const compact = compactPairingCode(raw);
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function pairingCodeVariants(raw: string): string[] {
  const compact = compactPairingCode(raw);
  const hyphenated = `${compact.slice(0, 4)}-${compact.slice(4)}`;
  return [...new Set([compact, hyphenated])];
}

function isUnrecognizedPairingCodeError(message: string): boolean {
  return /pairing code not recogni[sz]ed/i.test(message);
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
  const user = normalizeUser(record.user)
    ?? (typeof record.userId === 'string' || typeof record.user_id === 'string'
      ? { id: String(record.userId ?? record.user_id) }
      : undefined);
  return {
    ...tokens,
    user,
  };
}

async function gatewayFetch(path: string, init?: RequestInit, deviceToken?: string): Promise<Response> {
  const url = `${getOptraneApiBase()}${path}`;
  try {
    return await optraneFetch(url, {
      ...init,
      headers: publicGatewayHeaders({
        ...(deviceToken ? { 'X-OPTRANE-Device-Token': deviceToken } : {}),
        ...(init?.headers as Record<string, string> | undefined),
      }),
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`Could not reach OPTRANE at ${url}. Check your internet connection and use the Production gateway (film-sparkle-layer.lovable.app).`);
    }
    throw error;
  }
}

async function legacyJson<T>(path: string, init?: RequestInit, deviceToken?: string): Promise<T> {
  const response = await gatewayFetch(path, init, deviceToken);
  if (!response.ok) throw new Error(await readGatewayError(response));
  if (response.status === 204) return undefined as T;
  return unwrap<T>(await response.json());
}

export async function signInWithSupabasePassword(email: string, password: string): Promise<Pick<PairingClaimResult, 'accessToken' | 'refreshToken' | 'expiresIn' | 'tokenType' | 'user'>> {
  const url = `${OPTRANE_SUPABASE_URL}/auth/v1/token?grant_type=password`;
  let response: Response;
  try {
    response = await optraneFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: OPTRANE_GATEWAY_PUBLISHABLE_KEY,
        Authorization: `Bearer ${OPTRANE_GATEWAY_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ email, password }),
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Could not reach OPTRANE sign-in. Check your internet connection and try again.');
    }
    throw error;
  }
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

function mergeClaimWithSession(
  claim: Omit<PairingClaimResult, 'accessToken' | 'refreshToken'> & Partial<Pick<PairingClaimResult, 'accessToken' | 'refreshToken'>>,
  session: Partial<PairingClaimResult>,
): PairingClaimResult | null {
  const accessToken = session.accessToken ?? claim.accessToken;
  const refreshToken = session.refreshToken ?? claim.refreshToken;
  if (!accessToken || !refreshToken) return null;
  return {
    deviceToken: claim.deviceToken,
    accessToken,
    refreshToken,
    expiresIn: session.expiresIn ?? claim.expiresIn ?? 3600,
    tokenType: session.tokenType ?? claim.tokenType,
    user: session.user ?? claim.user,
  };
}

async function postPairingClaim(code: string): Promise<unknown> {
  const payload = {
    code,
    deviceName: 'OPTRANE Command',
    platform: navigator.platform || 'desktop',
    appVersion: await appVersion(),
    client: 'OPTRANE Command',
  };
  let lastError: Error | null = null;
  for (const variant of pairingCodeVariants(code)) {
    try {
      return await legacyJson<unknown>('/pairing/claim', {
        method: 'POST',
        body: JSON.stringify({ ...payload, code: variant }),
      });
    } catch (error) {
      if (!(error instanceof Error) || !isUnrecognizedPairingCodeError(error.message)) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error('Pairing code not recognised');
}

function mergePairingExchange(
  deviceToken: string,
  exchanged: Partial<PairingClaimResult>,
  hint?: DesktopUser,
): PairingClaimResult | null {
  if (!exchanged.accessToken || !exchanged.refreshToken) return null;
  return {
    deviceToken,
    accessToken: exchanged.accessToken,
    refreshToken: exchanged.refreshToken,
    expiresIn: exchanged.expiresIn ?? 3600,
    tokenType: exchanged.tokenType,
    user: exchanged.user ?? hint,
  };
}

/** Swap a saved device key for a fresh gateway session (POST /pairing/token). */
export async function exchangePairingToken(deviceToken: string, userHint?: DesktopUser): Promise<PairingClaimResult> {
  const value = await legacyJson<unknown>('/pairing/token', {
    method: 'POST',
    body: '{}',
  }, deviceToken);
  const exchanged = normalizeSessionRefresh(value);
  const session = mergePairingExchange(deviceToken, exchanged, userHint);
  if (!session) {
    throw new Error('The gateway did not return a desktop session for this paired device.');
  }
  return session;
}

async function finalizeClaim(
  claim: Omit<PairingClaimResult, 'accessToken' | 'refreshToken'> & Partial<Pick<PairingClaimResult, 'accessToken' | 'refreshToken'>>,
  password?: string,
): Promise<PairingClaimResult> {
  await savePendingPairing({ deviceToken: claim.deviceToken, user: claim.user });

  try {
    return await exchangePairingToken(claim.deviceToken, claim.user);
  } catch { /* fall through to claim payload / password */ }

  const direct = mergeClaimWithSession(claim, claim);
  if (direct) return direct;

  const session = await fetchPairingSession(claim.deviceToken).catch(() => ({} as Partial<PairingClaimResult>));
  const mergedUser = claim.user?.email ? claim.user : session.user ?? claim.user;
  const claimWithUser = { ...claim, user: mergedUser };
  const fromSession = mergeClaimWithSession(claimWithUser, session);
  if (fromSession) return fromSession;

  if (!password?.trim()) {
    throw new Error('Enter your OPTRANE website password to finish pairing. The gateway pairs the device first, then uses your account password to open the desktop session.');
  }
  return resolveLegacySession(claimWithUser, password);
}

export async function completePendingPairing(password?: string): Promise<PairingClaimResult> {
  const pending = await loadPendingPairing();
  if (!pending) {
    throw new Error('No pending desktop pairing was found on this device. Generate a new pairing code on the OPTRANE website.');
  }
  try {
    return await exchangePairingToken(pending.deviceToken, pending.user);
  } catch { /* fall through */ }

  const session = await fetchPairingSession(pending.deviceToken).catch(() => ({} as Partial<PairingClaimResult>));
  const claim: Omit<PairingClaimResult, 'accessToken' | 'refreshToken'> & Partial<Pick<PairingClaimResult, 'accessToken' | 'refreshToken'>> = {
    deviceToken: pending.deviceToken,
    expiresIn: session.expiresIn ?? 3600,
    user: pending.user?.email ? pending.user : session.user ?? pending.user,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    tokenType: session.tokenType,
  };
  if (!password?.trim()) {
    throw new Error('Enter your OPTRANE website password to finish pairing.');
  }
  return finalizeClaim(claim, password);
}

export async function claimPairingCode(code: string, password?: string): Promise<PairingClaimResult> {
  try {
    const value = await postPairingClaim(code);
    const claim = normalizeClaim(value);
    return finalizeClaim(claim, password);
  } catch (error) {
    if (!(error instanceof Error) || !isUnrecognizedPairingCodeError(error.message) || !password?.trim()) {
      throw error;
    }
    return completePendingPairing(password);
  }
}

export async function fetchPairingSession(deviceToken: string): Promise<Partial<PairingClaimResult>> {
  const value = await legacyJson<unknown>('/pairing/session', { method: 'GET' }, deviceToken);
  return normalizeSessionRefresh(value);
}

export async function sendPairingHeartbeat(deviceToken: string): Promise<void> {
  await legacyJson<void>('/pairing/heartbeat', { method: 'POST', body: '{}' }, deviceToken);
}

export const LEGACY_PAIRING_WEBSITE = OPTRANE_WEB_BASE;
