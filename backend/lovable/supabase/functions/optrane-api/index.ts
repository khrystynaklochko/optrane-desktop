import { admin } from '../_shared/db.ts';
import { requireMember, requireUser } from '../_shared/auth.ts';
import { approvePlan, appendAudit, createAnalysis, rejectPlan, runAnalysis } from '../_shared/analysis.ts';
import { ensureBreakdown } from '../_shared/breakdown.ts';
import { loadNightfallRevision, resetNightfall } from '../_shared/demo.ts';
import { env } from '../_shared/env.ts';
import { clickhouseConfigured, clickhousePing } from '../_shared/clickhouse.ts';
import { mcpConfigured, runClickHouseMcpQuery } from '../_shared/mcp_clickhouse.ts';
import { agentRuntimeConfigured, agentRuntimeReachable } from '../_shared/agent_runtime.ts';
import { bodyJson, corsHeaders, HttpError, json, noContent, parseFunctionPath, sseResponse, toErrorResponse } from '../_shared/http.ts';
import { sha256Hex, slug } from '../_shared/util.ts';

function waitUntil(promise: Promise<unknown>) {
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(promise);
  else promise.catch(console.error);
}

async function nextScriptVersion(productionId: string) {
  const { data, error } = await admin().from('script_versions').select('version').eq('production_id', productionId).order('version', { ascending: false }).limit(1);
  if (error) throw new Error(`script version query: ${error.message}`);
  return Number(data?.[0]?.version ?? 0) + 1;
}

async function initiateUpload(userId: string, productionId: string, kind: 'BASELINE'|'REVISION', input: { filename?: string; content_type?: string; size_bytes?: number }) {
  if (!input.filename?.toLowerCase().endsWith('.pdf')) throw new HttpError(422, 'Only PDF screenplays are supported', 'pdf_required');
  if ((input.size_bytes ?? 0) > 50 * 1024 * 1024) throw new HttpError(422, 'PDF exceeds 50 MB storage limit', 'file_too_large');
  const version = await nextScriptVersion(productionId);
  if (kind === 'BASELINE' && version !== 1) throw new HttpError(409, 'A baseline script already exists; upload this file as a revision', 'baseline_exists');
  const safeName = `${slug(input.filename.replace(/\.pdf$/i, ''))}.pdf`;
  const path = `${userId}/${productionId}/v${version}/${crypto.randomUUID()}-${safeName}`;
  const { data: signed, error: signedError } = await admin().storage.from('scripts').createSignedUploadUrl(path, { upsert: false });
  if (signedError || !signed) throw new Error(`create signed upload: ${signedError?.message ?? 'no upload token'}`);
  const token = (signed as any).token as string;
  if (!token) throw new Error('Storage did not return a signed upload token');
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const { data: ticket, error: ticketError } = await admin().from('upload_tickets').insert({
    production_id: productionId, script_version: version, kind, filename: input.filename, storage_path: path,
    upload_token: token, expires_at: expiresAt, created_by: userId,
  }).select('*').single();
  if (ticketError) throw new Error(`create upload ticket: ${ticketError.message}`);
  return {
    script_version: version,
    upload_id: ticket.id,
    upload_path: path,
    upload_token: token,
    bucket: 'scripts',
    expires_at: expiresAt,
  };
}

async function completeUpload(userId: string, productionId: string, uploadId: string, expectedVersion?: number) {
  const { data: ticket, error } = await admin().from('upload_tickets').select('*').eq('id', uploadId).eq('production_id', productionId).eq('created_by', userId).single();
  if (error || !ticket) throw new HttpError(404, 'Upload ticket not found', 'upload_not_found');
  if (ticket.completed_at) {
    const { data: existing } = await admin().from('script_versions').select('*').eq('production_id', productionId).eq('version', ticket.script_version).single();
    return existing;
  }
  if (expectedVersion != null && Number(ticket.script_version) !== expectedVersion) throw new HttpError(409, 'Script version mismatch', 'version_mismatch');
  if (new Date(ticket.expires_at).getTime() < Date.now()) throw new HttpError(410, 'Upload ticket expired', 'upload_expired');
  const { data: blob, error: downloadError } = await admin().storage.from('scripts').download(ticket.storage_path);
  if (downloadError || !blob) throw new HttpError(409, 'Uploaded screenplay object was not found', 'upload_incomplete');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!bytes.length) throw new HttpError(422, 'Uploaded screenplay is empty', 'empty_upload');
  const contentHash = await sha256Hex(bytes);
  const { data: version, error: versionError } = await admin().from('script_versions').insert({
    production_id: productionId, version: ticket.script_version, kind: ticket.kind, filename: ticket.filename,
    storage_path: ticket.storage_path, content_type: 'application/pdf', size_bytes: bytes.length, content_hash: contentHash,
    processing_status: 'QUEUED', created_by: userId,
  }).select('*').single();
  if (versionError) throw new Error(`register screenplay: ${versionError.message}`);
  await admin().from('upload_tickets').update({ completed_at: new Date().toISOString() }).eq('id', uploadId);
  await admin().from('productions').update({ current_script_version: ticket.script_version }).eq('id', productionId);
  await appendAudit(productionId, ticket.kind === 'BASELINE' ? 'SCRIPT_UPLOADED' : 'REVISION_UPLOADED', 'Producer', `${ticket.kind === 'BASELINE' ? 'Baseline' : 'Revision'} script v${ticket.script_version} uploaded`, { filename: ticket.filename, bytes: bytes.length });
  // Warm the structured breakdown in the background. Analysis also calls ensureBreakdown, so abrupt worker shutdown is safe/recoverable.
  const geminiConfigured = env.geminiProvider === 'vertex'
    ? Boolean(env.googleCloudProject && env.googleServiceAccountJson)
    : Boolean(env.geminiApiKey);
  if (geminiConfigured) waitUntil(ensureBreakdown(productionId, Number(ticket.script_version)).catch((error) => console.error('background breakdown failed', error)));
  return version;
}

async function productionSummary(productionId: string) {
  const { data: production, error } = await admin().from('productions').select('*').eq('id', productionId).single();
  if (error || !production) throw new HttpError(404, 'Production not found');
  const { data: risks } = await admin().from('risks').select('severity,status').eq('production_id', productionId).neq('status', 'RESOLVED');
  const { data: latestAnalysis } = await admin().from('analyses').select('id').eq('production_id', productionId).eq('status', 'COMPLETE').order('completed_at', { ascending: false }).limit(1).maybeSingle();
  let findings: Array<{ severity: string }> = [];
  if (latestAnalysis) {
    const result = await admin().from('impact_findings').select('severity,status').eq('analysis_id', latestAnalysis.id).neq('status', 'RESOLVED');
    findings = result.data ?? [];
  }
  const combined = [...(risks ?? []), ...findings];
  const counts = { CRITICAL: 0, HIGH: 0, WATCH: 0, LOW: 0 } as Record<string, number>;
  for (const item of combined) {
    if (item.severity === 'CRITICAL') counts.CRITICAL++;
    else if (item.severity === 'HIGH') counts.HIGH++;
    else if (item.severity === 'LOW') counts.LOW++;
    else counts.WATCH++;
  }
  return {
    productionId: production.id, title: production.title, readiness: production.readiness,
    scenes: production.scenes_count, crew: production.crew_count, cast: production.cast_count,
    locations: production.locations_count, plannedCost: Number(production.planned_cost),
    currentScriptVersion: production.current_script_version, riskCounts: counts, shootDayLabel: production.shoot_day_label,
  };
}

async function analysisPayload(productionId: string, analysisId: string) {
  const { data: analysis, error } = await admin().from('analyses').select('*').eq('id', analysisId).eq('production_id', productionId).single();
  if (error || !analysis) throw new HttpError(404, 'Analysis not found');
  const [{ data: changes }, { data: findings }] = await Promise.all([
    admin().from('script_changes').select('*').eq('analysis_id', analysisId).order('created_at'),
    admin().from('impact_findings').select('*').eq('analysis_id', analysisId).order('created_at'),
  ]);
  return {
    analysisId: analysis.id,
    status: analysis.status,
    revisionVersion: analysis.revision_version,
    changes: (changes ?? []).map((c) => ({ id: c.id, scene: c.scene_number, type: c.change_type, category: c.category, label: c.label, ignored: c.ignored })),
    impacts: (findings ?? []).map((f) => ({
      id: f.id, category: f.category, severity: ['MEDIUM','LOW'].includes(f.severity) ? 'WATCH' : f.severity,
      rawSeverity: f.severity, status: f.status, reason: f.reason, evidence: f.evidence, evidenceRefs: f.evidence_refs,
    })),
    readinessBefore: analysis.readiness_before,
    readinessAfter: analysis.readiness_after,
  };
}

async function eventsStream(productionId: string, analysisId: string) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const sent = new Set<string>();
      const started = Date.now();
      try {
        while (Date.now() - started < 120_000) {
          const { data: rows, error } = await admin().from('analysis_events').select('*').eq('analysis_id', analysisId).eq('production_id', productionId).order('created_at').order('id');
          if (error) throw new Error(error.message);
          for (const row of rows ?? []) {
            if (sent.has(row.id)) continue;
            sent.add(row.id);
            const payload = { id: row.id, type: row.type, actor: row.actor, message: row.message, status: row.status, createdAt: row.created_at, payload: row.payload ?? {} };
            controller.enqueue(encoder.encode(`id: ${row.id}\nevent: ${row.type}\ndata: ${JSON.stringify(payload)}\n\n`));
          }
          const terminal = (rows ?? []).find((row) => row.type === 'ANALYSIS_COMPLETE' || row.type === 'ANALYSIS_FAILED');
          if (terminal) break;
          controller.enqueue(encoder.encode(': keepalive\n\n'));
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      } catch (error) {
        controller.enqueue(encoder.encode(`event: stream_error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : String(error) })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });
}

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return noContent();
  const path = parseFunctionPath(req).replace(/\/$/, '') || '/';
  if (req.method === 'GET' && (path === '/' || path === '/healthz')) {
    return json({ status: 'ok', service: 'optrane-lovable-backend', mcp_required: env.requireMcp, agent_runtime_required: env.requireAgentRuntime });
  }

  const auth = await requireUser(req);

  if (req.method === 'GET' && path === '/api/system/integrations') {
    const [clickhouseReachable, runtimeReachable, mcpReachable] = await Promise.all([
      clickhousePing(),
      agentRuntimeReachable(),
      mcpConfigured() ? runClickHouseMcpQuery('SELECT 1 AS ok').then(() => true).catch(() => false) : Promise.resolve(false),
    ]);
    return json({
      gemini: { configured: Boolean(env.googleCloudProject), reachable: runtimeReachable, model: env.geminiModel },
      agentRuntime: { configured: agentRuntimeConfigured(), reachable: runtimeReachable, resource: env.googleAgentEngineResource ? 'configured' : undefined, adk: true },
      clickhouse: { configured: clickhouseConfigured(), reachable: clickhouseReachable, database: 'optrane' },
      mcp: { configured: mcpConfigured(), reachable: mcpReachable, tool: 'run_query', readOnly: true },
      strictMode: {
        requireMcp: env.requireMcp,
        requireAgentRuntime: env.requireAgentRuntime,
        ready: (!env.requireMcp || mcpReachable) && (!env.requireAgentRuntime || runtimeReachable) && clickhouseReachable,
      },
      agentcess: { configured: false, reachable: false, workspaceConnected: false },
    });
  }

  if (req.method === 'POST' && path === '/api/productions') {
    const input = await bodyJson<{ title?: string; shoot_start?: string; shoot_end?: string }>(req);
    if (!input.title?.trim()) throw new HttpError(422, 'Production title is required');
    const { data: production, error } = await admin().from('productions').insert({
      owner_id: auth.userId, title: input.title.trim(), shoot_start: input.shoot_start || null, shoot_end: input.shoot_end || null,
    }).select('*').single();
    if (error) throw new Error(`create production: ${error.message}`);
    await admin().from('production_members').insert({ production_id: production.id, user_id: auth.userId, role: 'OWNER' });
    await appendAudit(production.id, 'PRODUCTION_CREATED', 'Producer', `Production ${production.title} created`);
    return json({ production_id: production.id, title: production.title, status: production.status }, 201);
  }

  let m = path.match(/^\/api\/productions\/([^/]+)\/dashboard$/);
  if (req.method === 'GET' && m) {
    await requireMember(auth.userId, m[1]);
    return json(await productionSummary(m[1]));
  }

  m = path.match(/^\/api\/productions\/([^/]+)\/audit$/);
  if (req.method === 'GET' && m) {
    await requireMember(auth.userId, m[1]);
    const { data, error } = await admin().from('audit_events').select('*').eq('production_id', m[1]).order('created_at', { ascending: false }).limit(250);
    if (error) throw new Error(error.message);
    return json({ events: (data ?? []).map((e) => ({ id: e.id, time: new Date(e.created_at).toLocaleTimeString('en-GB', { hour12: false }), eventType: e.event_type, actor: e.actor, summary: e.summary, source: e.source, payload: e.payload })) });
  }

  m = path.match(/^\/api\/productions\/([^/]+)\/(scripts|revisions)\/initiate-upload$/);
  if (req.method === 'POST' && m) {
    await requireMember(auth.userId, m[1], true);
    const input = await bodyJson<{ filename?: string; content_type?: string; size_bytes?: number }>(req);
    return json(await initiateUpload(auth.userId, m[1], m[2] === 'scripts' ? 'BASELINE' : 'REVISION', input), 201);
  }

  m = path.match(/^\/api\/productions\/([^/]+)\/scripts\/complete-upload$/);
  if (req.method === 'POST' && m) {
    await requireMember(auth.userId, m[1], true);
    const input = await bodyJson<{ upload_id?: string }>(req);
    if (!input.upload_id) throw new HttpError(422, 'upload_id is required');
    const version = await completeUpload(auth.userId, m[1], input.upload_id);
    return json({ version: version.version, filename: version.filename, processing_status: version.processing_status });
  }

  m = path.match(/^\/api\/productions\/([^/]+)\/revisions\/(\d+)\/complete-upload$/);
  if (req.method === 'POST' && m) {
    await requireMember(auth.userId, m[1], true);
    const input = await bodyJson<{ upload_id?: string }>(req);
    if (!input.upload_id) throw new HttpError(422, 'upload_id is required');
    const version = await completeUpload(auth.userId, m[1], input.upload_id, Number(m[2]));
    return json({ version: version.version, filename: version.filename, processing_status: version.processing_status });
  }

  m = path.match(/^\/api\/productions\/([^/]+)\/revisions\/(\d+)\/analyse$/);
  if (req.method === 'POST' && m) {
    await requireMember(auth.userId, m[1], true);
    const analysis = await createAnalysis(m[1], Number(m[2]), auth.userId);
    waitUntil(runAnalysis(analysis.id).catch((error) => console.error('analysis background task failed', error)));
    return json({ analysisId: analysis.id, status: analysis.status }, 202);
  }

  m = path.match(/^\/api\/productions\/([^/]+)\/analyses\/([^/]+)$/);
  if (req.method === 'GET' && m) {
    await requireMember(auth.userId, m[1]);
    return json(await analysisPayload(m[1], m[2]));
  }

  m = path.match(/^\/api\/productions\/([^/]+)\/analyses\/([^/]+)\/events\/snapshot$/);
  if (req.method === 'GET' && m) {
    await requireMember(auth.userId, m[1]);
    const { data, error } = await admin().from('analysis_events').select('*').eq('analysis_id', m[2]).eq('production_id', m[1]).order('created_at').order('id');
    if (error) throw new Error(error.message);
    return json({ events: (data ?? []).map((row) => ({
      id: row.id, type: row.type, actor: row.actor, message: row.message, status: row.status,
      createdAt: row.created_at, payload: row.payload ?? {}, sequence: row.sequence ?? undefined,
    })) });
  }

  m = path.match(/^\/api\/productions\/([^/]+)\/analyses\/([^/]+)\/events$/);
  if (req.method === 'GET' && m) {
    await requireMember(auth.userId, m[1]);
    return sseResponse(await eventsStream(m[1], m[2]));
  }

  m = path.match(/^\/api\/productions\/([^/]+)\/analyses\/([^/]+)\/recovery-plans$/);
  if (req.method === 'GET' && m) {
    await requireMember(auth.userId, m[1]);
    const { data, error } = await admin().from('recovery_plans').select('*').eq('analysis_id', m[2]).eq('production_id', m[1]).order('code');
    if (error) throw new Error(error.message);
    return json({ plans: (data ?? []).map((p) => ({ id: p.id, code: p.code, title: p.title, costDelta: Number(p.estimated_cost_delta), scheduleDeltaMinutes: p.schedule_delta_minutes, risk: p.risk, changes: p.changes_count, recommended: p.recommended, actions: (p.actions ?? []).map((a: any) => a.human_label), assumptions: p.assumptions ?? [], unresolved: p.unresolved ?? [] })) });
  }

  m = path.match(/^\/api\/productions\/([^/]+)\/recovery-plans\/([^/]+)\/approve$/);
  if (req.method === 'POST' && m) {
    await requireMember(auth.userId, m[1], true);
    const input = await bodyJson<{ actor?: string }>(req).catch(() => ({ actor: 'Producer' }));
    const readiness = await approvePlan(m[1], m[2], auth.userId, input.actor?.trim() || 'Producer');
    return json({ readiness, planId: m[2], approved: true });
  }

  m = path.match(/^\/api\/productions\/([^/]+)\/recovery-plans\/([^/]+)\/reject$/);
  if (req.method === 'POST' && m) {
    await requireMember(auth.userId, m[1], true);
    const input: { actor?: string; reason?: string } = await bodyJson<{ actor?: string; reason?: string }>(req).catch(() => ({ actor: 'Producer', reason: undefined }));
    await rejectPlan(m[1], m[2], auth.userId, input.actor?.trim() || 'Producer', input.reason);
    return json({ planId: m[2], rejected: true });
  }

  m = path.match(/^\/api\/productions\/([^/]+)\/recovery-plans\/([^/]+)\/artifacts$/);
  if (req.method === 'GET' && m) {
    await requireMember(auth.userId, m[1]);
    const { data, error } = await admin().from('artifact_deltas').select('*').eq('production_id', m[1]).eq('plan_id', m[2]).order('created_at');
    if (error) throw new Error(error.message);
    return json({ artifacts: (data ?? []).map((a) => ({ kind: a.kind, title: a.title, lines: a.lines ?? [] })) });
  }

  m = path.match(/^\/api\/productions\/([^/]+)\/scenes\/([^/]+)\/graph$/);
  if (req.method === 'GET' && m) {
    await requireMember(auth.userId, m[1]);
    const { data, error } = await admin().from('production_dependencies').select('*').eq('production_id', m[1]).or(`source_id.eq.${m[2]},target_id.eq.${m[2]}`);
    if (error) throw new Error(error.message);
    const nodes = new Map<string, { id: string; type: string; label: string; state: string }>();
    nodes.set(`scene:${m[2]}`, { id: `scene:${m[2]}`, type: 'SCENE', label: `Scene ${m[2]}`, state: 'AFFECTED' });
    const edges = [] as Array<{ source: string; target: string; relation: string }>;
    for (const d of data ?? []) {
      const source = `${String(d.source_type).toLowerCase()}:${d.source_id}`;
      const target = `${String(d.target_type).toLowerCase()}:${d.target_id}`;
      nodes.set(source, nodes.get(source) ?? { id: source, type: d.source_type, label: d.source_id === m[2] ? `Scene ${m[2]}` : String(d.metadata?.label ?? d.source_id), state: d.source_id === m[2] ? 'AFFECTED' : d.state });
      nodes.set(target, nodes.get(target) ?? { id: target, type: d.target_type, label: String(d.metadata?.label ?? d.target_id).replaceAll('-', ' '), state: d.state });
      edges.push({ source, target, relation: d.relation });
    }
    return json({ nodes: [...nodes.values()], edges });
  }

  if (req.method === 'POST' && path === '/api/demo/reset') {
    if (!env.demoMode) throw new HttpError(403, 'Demo endpoints are disabled');
    const productionId = await resetNightfall(auth.userId);
    return json({ productionId, reset: true, dashboard: await productionSummary(productionId) });
  }

  if (req.method === 'POST' && path === '/api/demo/load-revision') {
    if (!env.demoMode) throw new HttpError(403, 'Demo endpoints are disabled');
    return json({ ...(await loadNightfallRevision(auth.userId)), loaded: true });
  }

  throw new HttpError(404, `Route not found: ${req.method} ${path}`, 'route_not_found');
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (error) {
    return toErrorResponse(error);
  }
});
