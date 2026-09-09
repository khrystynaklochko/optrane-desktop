import { admin } from './db.ts';
import { env } from './env.ts';
import { HttpError } from './http.ts';

/**
 * PRIVATE OPTRANE -> Agentcess peer adapter.
 * Nothing in this module is imported by the Tauri client. Public OPTRANE routes
 * return normalized governance state and never return Agentcess URLs, credentials,
 * peer identifiers, signatures, nonces, or provider-native policy payloads.
 */

function stripPem(value: string) {
  return value.replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '');
}

function bytesFromBase64(value: string) {
  const raw = atob(value);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function bytesToBase64(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function privateSigningKey() {
  if (!env.agentcessPrivateKey) throw new HttpError(503, 'Governance signing key is not configured', 'governance_not_configured');
  return crypto.subtle.importKey(
    'pkcs8',
    bytesFromBase64(stripPem(env.agentcessPrivateKey)),
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function signText(value: string) {
  const signature = await crypto.subtle.sign('Ed25519', await privateSigningKey(), new TextEncoder().encode(value));
  return bytesToBase64(signature);
}

function basicAuth() {
  if (!env.agentcessClientId || !env.agentcessClientSecret) throw new HttpError(503, 'Governance peer credentials are not configured', 'governance_not_configured');
  return `Basic ${btoa(`${env.agentcessClientId}:${env.agentcessClientSecret}`)}`;
}

export function agentcessConfigured() {
  return Boolean(
    env.agentcessApiBase && env.agentcessClientId && env.agentcessClientSecret
    && env.agentcessPrivateKey && env.agentcessPublicKey,
  );
}

async function currentConnection() {
  const { data, error } = await admin()
    .from('governance_peer_connections')
    .select('*')
    .eq('provider', 'Agentcess')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`governance peer state: ${error.message}`);
  return data;
}

export async function claimAgentcessPeer(input: { callbackUrl: string; instanceId: string }) {
  if (!agentcessConfigured()) throw new HttpError(503, 'Governance provider is not configured', 'governance_not_configured');
  const response = await fetch(`${env.agentcessApiBase}/v1/peers/claim`, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/json', 'User-Agent': 'OPTRANE-Governance-Peer/1.0' },
    body: JSON.stringify({
      peerType: 'OPTRANE',
      workspaceId: env.agentcessWorkspaceId || undefined,
      instanceId: input.instanceId,
      publicKey: env.agentcessPublicKey,
      callbackUrl: input.callbackUrl,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(502, `Governance peer claim failed (${response.status})`, 'governance_peer_claim_failed');
  const externalId = payload.connectionId ?? payload.connection_id ?? payload.id;
  if (!externalId || !payload.challenge) throw new HttpError(502, 'Governance provider returned an invalid peer challenge', 'governance_peer_invalid');
  const row = {
    provider: 'Agentcess',
    external_connection_id: externalId,
    workspace_id: payload.workspaceId ?? payload.workspace_id ?? env.agentcessWorkspaceId ?? null,
    status: 'CLAIMED',
    public_key: env.agentcessPublicKey,
    challenge: payload.challenge,
    challenge_expires_at: payload.expiresAt ?? payload.expires_at ?? null,
    metadata: { claimedAt: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await admin().from('governance_peer_connections').insert(row).select('*').single();
  if (error) throw new Error(`store peer claim: ${error.message}`);
  return data;
}

export async function verifyAgentcessPeer(connectionId?: string) {
  const connection = connectionId
    ? (await admin().from('governance_peer_connections').select('*').eq('id', connectionId).single()).data
    : await currentConnection();
  if (!connection) throw new HttpError(404, 'Governance peer connection is not claimed', 'governance_peer_missing');
  if (!connection.challenge) throw new HttpError(409, 'Governance peer challenge is missing', 'governance_peer_challenge_missing');
  if (connection.challenge_expires_at && Date.parse(connection.challenge_expires_at) < Date.now()) throw new HttpError(410, 'Governance peer challenge expired', 'governance_peer_challenge_expired');
  const timestamp = new Date().toISOString();
  const canonical = `${connection.external_connection_id}\n${connection.challenge}\n${timestamp}`;
  const signature = await signText(canonical);
  const response = await fetch(`${env.agentcessApiBase}/v1/peers/${encodeURIComponent(connection.external_connection_id)}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'OPTRANE-Governance-Peer/1.0' },
    body: JSON.stringify({ timestamp, signature }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(502, `Governance peer verification failed (${response.status})`, 'governance_peer_verify_failed');
  const status = payload.status ?? 'VERIFIED';
  const { data, error } = await admin().from('governance_peer_connections').update({
    status,
    challenge: null,
    challenge_expires_at: null,
    last_verified_at: new Date().toISOString(),
    metadata: { ...(connection.metadata ?? {}), providerStatus: status },
    updated_at: new Date().toISOString(),
  }).eq('id', connection.id).select('*').single();
  if (error) throw new Error(`store peer verification: ${error.message}`);
  return data;
}

async function signedHeaders(method: string, path: string, bodyText: string, connection: any) {
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const bodyHash = await sha256(bodyText);
  const canonical = `${method.toUpperCase()}\n${path}\n${bodyHash}\n${timestamp}\n${nonce}`;
  const signature = await signText(canonical);
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'OPTRANE-Governance-Peer/1.0',
    'X-Agentcess-Peer': String(connection.external_connection_id),
    'X-Agentcess-Timestamp': timestamp,
    'X-Agentcess-Nonce': nonce,
    'X-Agentcess-Signature': signature,
  };
}

export async function agentcessRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!agentcessConfigured()) throw new HttpError(503, 'Governance provider is not configured', 'governance_not_configured');
  const connection = await currentConnection();
  if (!connection || !['VERIFIED', 'CONNECTED', 'ACTIVE', 'OPEN'].includes(connection.status)) {
    throw new HttpError(503, 'Governance peer connection is not verified', 'governance_peer_not_verified');
  }
  const route = path.startsWith('/') ? path : `/${path}`;
  const method = (init.method ?? 'GET').toUpperCase();
  const bodyText = typeof init.body === 'string' ? init.body : init.body ? String(init.body) : '';
  const response = await fetch(`${env.agentcessApiBase}${route}`, {
    ...init,
    method,
    headers: { ...(await signedHeaders(method, route, bodyText, connection)), ...init.headers },
    body: init.body,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new HttpError(response.status >= 500 ? 502 : response.status, `Governance provider request failed (${response.status})${text ? `: ${text.slice(0, 180)}` : ''}`, 'governance_request_failed');
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export async function pingAgentcessPeer() {
  if (!agentcessConfigured()) return false;
  try {
    const connection = await currentConnection();
    if (!connection || !['VERIFIED', 'CONNECTED', 'ACTIVE', 'OPEN'].includes(connection.status)) return false;
    const response = await agentcessRequest<any>(`/v1/peers/${encodeURIComponent(connection.external_connection_id)}/ping`, {
      method: 'POST',
      body: JSON.stringify({ timestamp: new Date().toISOString(), optraneVersion: '0.5.0' }),
    });
    await admin().from('governance_peer_connections').update({
      status: response.status ?? connection.status,
      last_ping_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', connection.id);
    return true;
  } catch { return false; }
}

export async function closeAgentcessPeer(connectionId?: string) {
  const connection = connectionId
    ? (await admin().from('governance_peer_connections').select('*').eq('id', connectionId).single()).data
    : await currentConnection();
  if (!connection) throw new HttpError(404, 'Governance peer connection not found', 'governance_peer_missing');
  if (['VERIFIED', 'CONNECTED', 'ACTIVE', 'OPEN'].includes(connection.status)) {
    await agentcessRequest(`/v1/peers/${encodeURIComponent(connection.external_connection_id)}/close`, { method: 'POST', body: '{}' });
  }
  const { data } = await admin().from('governance_peer_connections').update({ status: 'DISCONNECTED', updated_at: new Date().toISOString() }).eq('id', connection.id).select('*').single();
  return data;
}

export async function governanceProviderStatus() {
  const connection = await currentConnection();
  const reachable = await pingAgentcessPeer();
  return {
    provider: 'Agentcess',
    configured: agentcessConfigured(),
    connected: Boolean(connection && ['VERIFIED', 'CONNECTED', 'ACTIVE', 'OPEN'].includes(connection.status)),
    reachable,
    status: connection?.status ?? 'DISCONNECTED',
    lastHeartbeatAt: connection?.last_ping_at ?? null,
  };
}

// Backward-compatible private name used by older internal code only.
export const agentcessPing = pingAgentcessPeer;
