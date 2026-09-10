import { env } from '../_shared/env.ts';
import { claimAgentcessPeer, closeAgentcessPeer, governanceProviderStatus, pingAgentcessPeer, verifyAgentcessPeer } from '../_shared/agentcess.ts';
import { HttpError, json, noContent, toErrorResponse } from '../_shared/http.ts';

function pathOf(req: Request) {
  const url = new URL(req.url);
  const marker = '/optrane-governance-admin';
  const idx = url.pathname.indexOf(marker);
  return idx >= 0 ? url.pathname.slice(idx + marker.length).replace(/\/$/, '') || '/' : url.pathname;
}

function requireAdmin(req: Request) {
  const supplied = req.headers.get('x-optrane-admin-key') ?? '';
  if (!env.governanceAdminKey || supplied !== env.governanceAdminKey) throw new HttpError(401, 'Admin authentication required', 'admin_auth_required');
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return noContent();
    requireAdmin(req);
    const path = pathOf(req);
    if (req.method === 'GET' && path === '/status') return json(await governanceProviderStatus());
    if (req.method === 'POST' && path === '/claim') {
      const input = await req.json().catch(() => ({})) as any;
      const base = (Deno.env.get('OPTRANE_WEB_BASE') ?? '').replace(/\/$/, '');
      const row = await claimAgentcessPeer({
        callbackUrl: input.callbackUrl ?? `${base}/api/public/itrain-agentcess-webhook`,
        instanceId: input.instanceId ?? 'optrane-production',
      });
      return json({ connectionId: row.id, status: row.status, provider: row.provider }, 201);
    }
    if (req.method === 'POST' && path === '/verify') {
      const input = await req.json().catch(() => ({})) as any;
      const row = await verifyAgentcessPeer(input.connectionId ?? input.connection_id);
      return json({ connectionId: row.id, status: row.status, provider: row.provider });
    }
    if (req.method === 'POST' && path === '/ping') return json({ ok: await pingAgentcessPeer() });
    if (req.method === 'POST' && path === '/close') {
      const input = await req.json().catch(() => ({})) as any;
      const row = await closeAgentcessPeer(input.connectionId ?? input.connection_id);
      return json({ connectionId: row.id, status: row.status, provider: row.provider });
    }
    throw new HttpError(404, `Route not found: ${req.method} ${path}`, 'route_not_found');
  } catch (error) { return toErrorResponse(error); }
});
