import { getOptraneApiBase, OPTRANE_GATEWAY_PUBLISHABLE_KEY } from '../config/optrane';
import { optraneFetch } from './optraneFetch';

export function publicGatewayHeaders(extra: Record<string, string> = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-optrane-client': 'desktop',
    ...extra,
  };
  if (OPTRANE_GATEWAY_PUBLISHABLE_KEY) {
    headers.apikey = OPTRANE_GATEWAY_PUBLISHABLE_KEY;
    // Keep caller-supplied user/session JWT; only use publishable key for bootstrap routes.
    if (!headers.Authorization && !headers.authorization) {
      headers.Authorization = `Bearer ${OPTRANE_GATEWAY_PUBLISHABLE_KEY}`;
    }
  }
  return headers;
}

export async function readGatewayError(response: Response): Promise<string> {
  let message = `${response.status} ${response.statusText}`;
  try {
    const body = await response.json() as {
      error?: string | { message?: string; code?: string };
      detail?: string;
      code?: string;
    };
    if (typeof body.error === 'string') message = body.error;
    else message = body.error?.message ?? body.detail ?? message;
  } catch { /* keep HTTP status */ }
  return explainGatewayFailure(response.status, message);
}

export function explainGatewayFailure(status: number, message: string): string {
  if (status === 401 && message === 'Missing bearer token') {
    return 'The OPTRANE gateway rejected the desktop pairing bootstrap request. The Lovable backend must expose public /desktop-auth routes.';
  }
  if (status === 401 && /invalid or expired token/i.test(message)) {
    return 'OPTRANE rejected the desktop session token. Disconnect, pair again, or wait a moment and retry.';
  }
  if (status === 409 && /not approved yet/i.test(message)) {
    return 'Website verification is not approved yet. Sign in on the OPTRANE website and click “Verify OPTRANE Command”.';
  }
  if (status === 410 && /expired/i.test(message)) {
    return 'This pairing request expired. Start again from OPTRANE Command.';
  }
  if (/pairing code not recogni[sz]ed/i.test(message)) {
    return 'This pairing code was already used or has expired. If the website shows “Command connected”, enter your website password and click Finish pairing — do not reuse the code. Otherwise generate a new code on the website.';
  }
  return message;
}

export async function publicGatewayJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await optraneFetch(`${getOptraneApiBase()}${path}`, {
    ...init,
    headers: publicGatewayHeaders(init?.headers as Record<string, string> | undefined),
  });
  if (!response.ok) throw new Error(await readGatewayError(response));
  const body = await response.json() as { data?: T } | T;
  return body && typeof body === 'object' && 'data' in body ? (body as { data: T }).data : body as T;
}

export type GatewayPairingState = 'ready' | 'legacy' | 'bootstrap-blocked' | 'backend-outdated';

async function readGatewayErrorBody(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string | { message?: string }; detail?: string };
    if (typeof body.error === 'string') return body.error;
    return body.error?.message ?? body.detail ?? `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

export async function probeGatewayPairing(): Promise<GatewayPairingState> {
  try {
    const response = await optraneFetch(`${getOptraneApiBase()}/desktop-auth/start`, {
      method: 'POST',
      headers: publicGatewayHeaders(),
      body: JSON.stringify({ callbackUri: 'optrane://auth/callback', client: 'OPTRANE Command' }),
    });
    if (response.status === 201 || response.status === 200) return 'ready';

    const message = await readGatewayErrorBody(response);
    if (/Missing bearer token/i.test(message)) return 'bootstrap-blocked';

    const claimResponse = await optraneFetch(`${getOptraneApiBase()}/pairing/claim`, {
      method: 'POST',
      headers: publicGatewayHeaders(),
      body: JSON.stringify({ code: '0000-0000', deviceName: 'probe', platform: 'probe' }),
    });
    const claimMessage = await readGatewayErrorBody(claimResponse);
    if (/pairing code/i.test(claimMessage)) return 'legacy';

    // Production film-sparkle still runs legacy itrain-api pairing even when the probe is inconclusive.
    return 'legacy';
  } catch {
    return 'legacy';
  }
}
