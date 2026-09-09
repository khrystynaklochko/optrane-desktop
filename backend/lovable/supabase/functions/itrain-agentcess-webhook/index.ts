import { admin } from '../_shared/db.ts';
import { env } from '../_shared/env.ts';
import { json, noContent, toErrorResponse, HttpError } from '../_shared/http.ts';

async function hmacHex(secret: string, text: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return noContent();
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed', 'method_not_allowed');
    const secret = env.agentcessWebhookSecret;
    if (!secret) throw new HttpError(503, 'Governance webhook secret is not configured', 'webhook_not_configured');

    const eventId = req.headers.get('x-agentcess-event-id') ?? '';
    const timestamp = req.headers.get('x-agentcess-timestamp') ?? '';
    const supplied = (req.headers.get('x-agentcess-signature') ?? '').replace(/^sha256=/, '');
    if (!eventId || !timestamp || !supplied) throw new HttpError(401, 'Missing governance webhook signature headers', 'invalid_webhook_signature');
    const parsedTime = Date.parse(timestamp);
    if (!Number.isFinite(parsedTime) || Math.abs(Date.now() - parsedTime) > 5 * 60_000) throw new HttpError(401, 'Stale governance webhook timestamp', 'stale_webhook');
    const { data: duplicate } = await admin().from('governance_webhook_receipts').select('event_id').eq('event_id', eventId).maybeSingle();
    if (duplicate) return json({ received: true, duplicate: true });

    const raw = await req.text();
    const expected = await hmacHex(secret, `${timestamp}.${raw}`);
    if (!timingSafeEqual(supplied, expected)) throw new HttpError(401, 'Invalid governance webhook signature', 'invalid_webhook_signature');
    const event = JSON.parse(raw) as any;
    const externalAgentId = event.agentId ?? event.agent_id ?? event.data?.agentId ?? event.data?.agent_id;
    const eventType = event.type ?? event.eventType ?? event.event_type ?? 'agent.updated';

    if (externalAgentId) {
      const update: Record<string, unknown> = { last_agentcess_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const trust = event.trustStatus ?? event.trust_status ?? event.data?.trustStatus ?? event.data?.trust_status;
      const score = event.trustScore ?? event.trust_score ?? event.data?.trustScore ?? event.data?.trust_score;
      if (trust) update.trust_status = trust;
      if (score != null) update.trust_score = score;
      if (eventType.includes('revoked')) { update.status = 'REVOKED'; update.trust_status = 'REVOKED'; }
      if (eventType.includes('restricted')) { update.status = 'RESTRICTED'; update.trust_status = trust ?? 'RESTRICTED'; }
      await admin().from('production_agents').update(update).eq('agentcess_agent_id', externalAgentId);
    }

    await admin().from('governance_webhook_receipts').insert({ event_id: eventId, provider: 'Agentcess' });
    return json({ received: true });
  } catch (error) { return toErrorResponse(error); }
});
