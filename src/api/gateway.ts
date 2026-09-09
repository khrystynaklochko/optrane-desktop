import { OPTRANE_API_BASE, OPTRANE_GATEWAY_PUBLISHABLE_KEY } from '../config/optrane';

export function publicGatewayHeaders(extra: Record<string, string> = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-optrane-client': 'desktop',
    ...extra,
  };
  if (OPTRANE_GATEWAY_PUBLISHABLE_KEY) {
    headers.Authorization = `Bearer ${OPTRANE_GATEWAY_PUBLISHABLE_KEY}`;
    headers.apikey = OPTRANE_GATEWAY_PUBLISHABLE_KEY;
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
    return 'The OPTRANE gateway is not running the desktop pairing backend yet. Redeploy backend/lovable (itrain-api and the /desktop/verify page), then try pairing again.';
  }
  if (status === 409 && /not approved yet/i.test(message)) {
    return 'Website verification is not approved yet. Sign in on the OPTRANE website and click “Verify OPTRANE Command”.';
  }
  if (status === 410 && /expired/i.test(message)) {
    return 'This pairing request expired. Start again from OPTRANE Command.';
  }
  return message;
}

export async function publicGatewayJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${OPTRANE_API_BASE}${path}`, {
    ...init,
    headers: publicGatewayHeaders(init?.headers as Record<string, string> | undefined),
  });
  if (!response.ok) throw new Error(await readGatewayError(response));
  const body = await response.json() as { data?: T } | T;
  return body && typeof body === 'object' && 'data' in body ? (body as { data: T }).data : body as T;
}

export async function probeGatewayPairing(): Promise<'ready' | 'bootstrap-blocked' | 'backend-outdated'> {
  const response = await fetch(`${OPTRANE_API_BASE}/desktop-auth/start`, {
    method: 'POST',
    headers: publicGatewayHeaders(),
    body: JSON.stringify({ callbackUri: 'optrane://auth/callback', client: 'OPTRANE Command' }),
  });
  if (response.status === 201 || response.status === 200) return 'ready';
  const message = await readGatewayError(response);
  if (/Missing bearer token/i.test(message)) return 'bootstrap-blocked';
  return 'backend-outdated';
}
