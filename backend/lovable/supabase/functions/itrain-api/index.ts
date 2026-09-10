import { admin } from '../_shared/db.ts';
import { requireMember, requireUser } from '../_shared/auth.ts';
import { approvePlan, appendAudit, createAnalysis, rejectPlan, runAnalysis } from '../_shared/analysis.ts';
import { ensureBreakdown } from '../_shared/breakdown.ts';
import { loadNightfallRevision, nightfallRevisionPreview, resetNightfall } from '../_shared/demo.ts';
import { clickhouseConfigured, clickhousePing } from '../_shared/clickhouse.ts';
import { mcpConfigured, runClickHouseMcpQuery } from '../_shared/mcp_clickhouse.ts';
import { agentRuntimeConfigured, agentRuntimeReachable } from '../_shared/agent_runtime.ts';
import { agentcessConfigured, agentcessRequest, governanceProviderStatus } from '../_shared/agentcess.ts';
import { env } from '../_shared/env.ts';
import { HttpError, json, noContent, sseResponse, toErrorResponse } from '../_shared/http.ts';
import { sha256Hex, slug } from '../_shared/util.ts';
import { consumeMagicLinkToken, publicAuthClient } from '../_shared/session_exchange.ts';
import { decideImprovement, improvementBudgetState, normalizedSelfImprovement, proposeImprovement } from '../_shared/self_improvement.ts';

function waitUntil(promise: Promise<unknown>) {
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(promise);
  else promise.catch(console.error);
}

function pathOf(req: Request) {
  const url = new URL(req.url);
  for (const marker of ['/api/public/itrain-api', '/functions/v1/itrain-api', '/itrain-api']) {
    const index = url.pathname.indexOf(marker);
    if (index >= 0) return url.pathname.slice(index + marker.length).replace(/\/$/, '') || '/';
  }
  return url.pathname.replace(/\/$/, '') || '/';
}

function recordingTestEmails() {
  return new Set((Deno.env.get('OPTRANE_RECORDING_TEST_EMAILS') ?? 'khrystynaklochko@gmail.com').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function requireRecordingTestUser(auth: { email?: string }) {
  const email = auth.email?.trim().toLowerCase();
  if (!email || !recordingTestEmails().has(email)) throw new HttpError(403, 'Recording demo is restricted to the configured OPTRANE test account', 'recording_test_user_required');
  return email;
}

function randomSecret(bytes = 32) {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashText(value: string) {
  return sha256Hex(new TextEncoder().encode(value));
}

async function body<T>(req: Request): Promise<T> {
  try { return await req.json() as T; }
  catch { throw new HttpError(400, 'Invalid JSON body', 'invalid_json'); }
}

async function productionSummary(productionId: string) {
  const { data: p, error } = await admin().from('productions').select('*').eq('id', productionId).single();
  if (error || !p) throw new HttpError(404, 'Production not found', 'production_not_found');
  const { data: risks } = await admin().from('risks').select('severity,status').eq('production_id', productionId).neq('status', 'RESOLVED');
  const { data: latest } = await admin().from('analyses').select('id').eq('production_id', productionId).eq('status', 'COMPLETE').order('completed_at', { ascending: false }).limit(1).maybeSingle();
  let findings: any[] = [];
  if (latest?.id) findings = (await admin().from('impact_findings').select('severity,status').eq('analysis_id', latest.id).neq('status', 'RESOLVED')).data ?? [];
  const counts: Record<string, number> = { CRITICAL: 0, HIGH: 0, WATCH: 0, LOW: 0 };
  for (const item of [...(risks ?? []), ...findings]) {
    if (item.severity === 'CRITICAL') counts.CRITICAL += 1;
    else if (item.severity === 'HIGH') counts.HIGH += 1;
    else if (item.severity === 'LOW') counts.LOW += 1;
    else counts.WATCH += 1;
  }
  return {
    productionId: p.id,
    title: p.title,
    readiness: p.readiness,
    scenes: p.scenes_count,
    crew: p.crew_count,
    cast: p.cast_count,
    locations: p.locations_count,
    plannedCost: Number(p.planned_cost),
    currentScriptVersion: p.current_script_version,
    riskCounts: counts,
    shootDayLabel: p.shoot_day_label,
    status: p.status,
  };
}

async function analysisPayload(analysisId: string) {
  const { data: analysis, error } = await admin().from('analyses').select('*').eq('id', analysisId).single();
  if (error || !analysis) throw new HttpError(404, 'Analysis not found', 'analysis_not_found');
  const [{ data: changes }, { data: findings }, { data: plans }] = await Promise.all([
    admin().from('script_changes').select('*').eq('analysis_id', analysisId).order('created_at'),
    admin().from('impact_findings').select('*').eq('analysis_id', analysisId).order('created_at'),
    admin().from('recovery_plans').select('*').eq('analysis_id', analysisId).order('code'),
  ]);
  return {
    analysisId: analysis.id,
    productionId: analysis.production_id,
    status: analysis.status,
    revisionVersion: analysis.revision_version,
    changes: (changes ?? []).map((c) => ({ id: c.id, scene: c.scene_number, type: c.change_type, category: c.category, label: c.label, ignored: c.ignored })),
    impacts: (findings ?? []).map((f) => ({ id: f.id, category: f.category, severity: ['MEDIUM','LOW'].includes(f.severity) ? 'WATCH' : f.severity, rawSeverity: f.severity, status: f.status, reason: f.reason, evidence: f.evidence, evidenceRefs: f.evidence_refs })),
    readinessBefore: analysis.readiness_before,
    readinessAfter: analysis.readiness_after,
    recoveryPlans: (plans ?? []).map((p) => ({ id: p.id, code: p.code, title: p.title, estimatedCostDelta: Number(p.estimated_cost_delta), estimatedScheduleDeltaMinutes: p.schedule_delta_minutes, risk: p.risk, changes: p.changes_count, recommended: p.recommended, actions: (p.actions ?? []).map((a: any) => a.human_label ?? a.label ?? a.type), assumptions: p.assumptions ?? [], unresolved: p.unresolved ?? [], status: p.status })),
  };
}

async function eventsStream(analysisId: string) {
  const { data: analysis } = await admin().from('analyses').select('production_id').eq('id', analysisId).single();
  if (!analysis) throw new HttpError(404, 'Analysis not found', 'analysis_not_found');
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const sent = new Set<string>();
      const started = Date.now();
      try {
        while (Date.now() - started < 120_000) {
          const { data: rows, error } = await admin().from('analysis_events').select('*').eq('analysis_id', analysisId).order('created_at').order('id');
          if (error) throw new Error(error.message);
          for (const row of rows ?? []) {
            if (sent.has(row.id)) continue;
            sent.add(row.id);
            const payload = { id: row.id, type: row.type, actor: row.actor, message: row.message, status: row.status, createdAt: row.created_at, payload: row.payload ?? {} };
            controller.enqueue(encoder.encode(`id: ${row.id}\nevent: ${row.type}\ndata: ${JSON.stringify(payload)}\n\n`));
          }
          if ((rows ?? []).some((row) => ['ANALYSIS_COMPLETE','ANALYSIS_COMPLETED','ANALYSIS_FAILED'].includes(row.type))) break;
          controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        controller.enqueue(encoder.encode(`event: stream_error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : String(error) })}\n\n`));
      } finally { controller.close(); }
    },
  });
}

async function uploadScript(req: Request, userId: string) {
  const form = await req.formData();
  const productionId = String(form.get('productionId') ?? form.get('production_id') ?? '');
  const kind = String(form.get('kind') ?? 'REVISION').toUpperCase() === 'BASELINE' ? 'BASELINE' : 'REVISION';
  const file = form.get('file');
  if (!productionId) throw new HttpError(422, 'productionId is required', 'production_required');
  await requireMember(userId, productionId, true);
  if (!(file instanceof File)) throw new HttpError(422, 'file is required', 'file_required');
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) throw new HttpError(422, 'Only PDF screenplays are supported', 'pdf_required');
  if (file.size > 50 * 1024 * 1024) throw new HttpError(422, 'PDF exceeds 50 MB', 'file_too_large');

  const { data: versions, error: versionError } = await admin().from('script_versions').select('version').eq('production_id', productionId).order('version', { ascending: false }).limit(1);
  if (versionError) throw new Error(versionError.message);
  const version = Number(versions?.[0]?.version ?? 0) + 1;
  if (kind === 'BASELINE' && version !== 1) throw new HttpError(409, 'Baseline already exists', 'baseline_exists');
  const safeName = `${slug(file.name.replace(/\.pdf$/i, ''))}.pdf`;
  const storagePath = `${userId}/${productionId}/v${version}/${crypto.randomUUID()}-${safeName}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: uploadError } = await admin().storage.from('scripts').upload(storagePath, bytes, { contentType: 'application/pdf', upsert: false });
  if (uploadError) throw new Error(`storage upload: ${uploadError.message}`);
  const contentHash = await sha256Hex(bytes);
  const { data: script, error: insertError } = await admin().from('script_versions').insert({
    production_id: productionId, version, kind, filename: file.name, storage_path: storagePath, content_type: 'application/pdf', size_bytes: file.size, content_hash: contentHash, processing_status: 'QUEUED', created_by: userId,
  }).select('*').single();
  if (insertError) throw new Error(`script insert: ${insertError.message}`);
  await admin().from('productions').update({ current_script_version: version }).eq('id', productionId);
  await appendAudit(productionId, kind === 'BASELINE' ? 'SCRIPT_UPLOADED' : 'REVISION_UPLOADED', 'Producer', `${kind === 'BASELINE' ? 'Baseline' : 'Revision'} script v${version} uploaded through OPTRANE gateway`, { filename: file.name, bytes: file.size });
  waitUntil(ensureBreakdown(productionId, version).catch((error) => console.error('background breakdown failed', error)));
  return { productionId, version, filename: script.filename, kind, processingStatus: script.processing_status };
}

function normalizeAgent(row: any) {
  const improvement = normalizedSelfImprovement({
    ...(row.self_improvement_policy ?? {}),
    budget: row.self_improvement_budget ?? row.self_improvement_policy?.budget ?? {},
  });
  return {
    id: row.id,
    productionId: row.production_id,
    name: row.name,
    agentType: row.agent_type,
    purpose: row.purpose,
    runtime: row.runtime,
    model: row.model,
    status: row.status,
    capabilities: row.capabilities ?? [],
    tools: row.tools ?? [],
    dataClasses: row.data_classes ?? [],
    budget: row.budget ?? {},
    selfImprovement: improvement,
    registrationError: row.registration_error,
    governance: row.agentcess_agent_id ? {
      provider: 'Agentcess',
      passportId: row.agentcess_agent_id,
      passportVersion: row.agentcess_passport_version ?? '—',
      trustStatus: row.trust_status ?? 'UNVERIFIED',
      trustScore: row.trust_score,
      lastSyncAt: row.last_agentcess_sync_at,
    } : null,
    createdAt: row.created_at,
  };
}

async function registerAgent(userId: string, productionId: string, input: any) {
  await requireMember(userId, productionId, true);
  if (!input.name?.trim() || !input.purpose?.trim()) throw new HttpError(422, 'Agent name and purpose are required', 'agent_input_required');
  const localId = crypto.randomUUID();
  const selfImprovement = normalizedSelfImprovement(input.selfImprovement ?? input.self_improvement ?? {});
  const capabilities = Array.from(new Set([...(input.capabilities ?? []), ...(selfImprovement.enabled ? ['SELF_IMPROVEMENT_PROPOSE'] : [])]));
  const baseRow = {
    id: localId,
    production_id: productionId,
    name: input.name.trim(),
    agent_type: input.agentType ?? input.agent_type ?? 'CUSTOM',
    purpose: input.purpose.trim(),
    runtime: input.runtime ?? 'GOOGLE_ADK',
    model: input.model ?? 'gemini-3.5-flash',
    owner_user_id: userId,
    status: 'REGISTERING',
    capabilities,
    tools: input.tools ?? [],
    data_classes: input.dataClasses ?? input.data_classes ?? [],
    budget: input.budget ?? { currency: 'USD', perRun: 1, daily: 10 },
    self_improvement_policy: {
      enabled: selfImprovement.enabled,
      rule: selfImprovement.rule,
      allowed: selfImprovement.allowed,
      forbidden: selfImprovement.forbidden,
      requiresHumanApproval: true,
    },
    self_improvement_budget: selfImprovement.budget,
    strategy_config: {},
    active_config_version: 1,
  };
  const { data: local, error } = await admin().from('production_agents').insert(baseRow).select('*').single();
  if (error) throw new Error(`agent insert: ${error.message}`);
  try {
    // Private provider provisioning. These endpoint paths and provider payloads never leave the OPTRANE backend.
    const remote = await agentcessRequest<any>('/v1/agents', {
      method: 'POST',
      body: JSON.stringify({
        externalSystem: 'OPTRANE',
        externalAgentId: localId,
        name: baseRow.name,
        type: baseRow.agent_type,
        purpose: baseRow.purpose,
        owner: { externalUserId: userId },
        runtime: { provider: baseRow.runtime, model: baseRow.model },
        context: { productionId },
        metadata: { application: 'OPTRANE' },
      }),
    });
    const providerAgentId = remote.agentId ?? remote.agent_id ?? remote.id;
    if (!providerAgentId) throw new Error('Governance provider did not return a passport identity');

    await agentcessRequest(`/v1/agents/${encodeURIComponent(providerAgentId)}/capabilities`, {
      method: 'PUT', body: JSON.stringify({ capabilities: baseRow.capabilities }),
    });
    await agentcessRequest(`/v1/agents/${encodeURIComponent(providerAgentId)}/tools`, {
      method: 'PUT', body: JSON.stringify({ tools: baseRow.tools }),
    });
    await agentcessRequest(`/v1/agents/${encodeURIComponent(providerAgentId)}/access-grants`, {
      method: 'PUT', body: JSON.stringify({ dataClasses: baseRow.data_classes }),
    });
    await agentcessRequest(`/v1/agents/${encodeURIComponent(providerAgentId)}/policies`, {
      method: 'PUT', body: JSON.stringify({
        policies: [
          { policyKey: 'optrane-default-agent-policy', version: '1.0' },
          ...(selfImprovement.enabled ? [{ policyKey: 'optrane-self-improvement-v1', version: '1.0' }] : []),
        ],
      }),
    });
    await agentcessRequest(`/v1/agents/${encodeURIComponent(providerAgentId)}/budget`, {
      method: 'PUT', body: JSON.stringify({
        currency: baseRow.budget.currency ?? 'USD',
        execution: { perRun: baseRow.budget.perRun ?? baseRow.budget.per_run ?? 1, daily: baseRow.budget.daily ?? 10 },
        selfImprovement: {
          perIteration: selfImprovement.budget.perIteration,
          daily: selfImprovement.budget.daily,
          maxIterationsPerRun: selfImprovement.budget.maxIterationsPerRun,
          maxDailyIterations: selfImprovement.budget.maxDailyIterations,
        },
      }),
    });

    const updated = {
      status: 'ACTIVE',
      agentcess_agent_id: providerAgentId,
      agentcess_passport_version: remote.passportVersion ?? remote.passport_version ?? remote.passport?.version ?? '1.0',
      trust_status: remote.trustStatus ?? remote.trust_status ?? remote.status ?? 'VERIFIED',
      trust_score: remote.trustScore ?? remote.trust_score ?? null,
      workspace_id: remote.workspaceId ?? remote.workspace_id ?? null,
      last_agentcess_sync_at: new Date().toISOString(),
      registration_error: null,
    };
    const { data: saved } = await admin().from('production_agents').update(updated).eq('id', localId).select('*').single();
    await admin().from('agent_config_versions').insert({ production_id: productionId, agent_id: localId, version: 1, strategy_config: {}, created_by: userId });
    await appendAudit(productionId, 'AGENT_REGISTERED', 'Producer', `${baseRow.name} registered with governed identity`, { localAgentId: localId });
    return normalizeAgent(saved ?? { ...local, ...updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin().from('production_agents').update({ status: 'REGISTRATION_FAILED', registration_error: message }).eq('id', localId);
    throw new HttpError(502, `Governed agent registration failed: ${message}`, 'governed_agent_registration_failed');
  }
}

const defaultFleet: any[] = [
  { name: 'Production Director', agentType: 'DIRECTOR', purpose: 'Coordinate governed production agents and approval-gated decisions.', capabilities: ['COORDINATE_AGENTS','ANALYSIS_READ','APPROVAL_REQUEST'], tools: [], dataClasses: [], budget: { currency: 'USD', perRun: 1, daily: 10 } },
  { name: 'Breakdown Agent', agentType: 'BREAKDOWN', purpose: 'Extract structured production information from screenplay versions.', capabilities: ['SCRIPT_READ','SCRIPT_ANALYSE','BREAKDOWN_GENERATE'], tools: [], dataClasses: [{ dataClass: 'SCRIPT_CONTENT', access: 'ALLOWED' }], budget: { currency: 'USD', perRun: 1, daily: 10 } },
  { name: 'Revision Agent', agentType: 'REVISION', purpose: 'Detect material differences between screenplay versions.', capabilities: ['SCRIPT_READ','SCENE_COMPARE','CHANGE_DETECTION'], tools: [], dataClasses: [{ dataClass: 'SCRIPT_CONTENT', access: 'ALLOWED' }], budget: { currency: 'USD', perRun: 1, daily: 10 } },
  { name: 'Impact Agent', agentType: 'IMPACT', purpose: 'Determine the operational blast radius using verified ClickHouse evidence.', capabilities: ['PRODUCTION_READ','DEPENDENCY_QUERY','IMPACT_ANALYSIS'], tools: [{ toolKey: 'clickhouse.run_query', provider: 'CLICKHOUSE_MCP', accessMode: 'READ' }], dataClasses: [{ dataClass: 'SCHEDULE', access: 'ALLOWED' }], budget: { currency: 'USD', perRun: 1, daily: 10 } },
  { name: 'Recovery Agent', agentType: 'RECOVERY', purpose: 'Generate recovery alternatives without mutating production state.', capabilities: ['ANALYSIS_READ','SCHEDULE_READ','RECOVERY_GENERATION'], tools: [], dataClasses: [{ dataClass: 'SCHEDULE', access: 'ALLOWED' }], budget: { currency: 'USD', perRun: 1, daily: 10 } },
];

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return noContent();
  const path = pathOf(req);
  const url = new URL(req.url);

  if (req.method === 'GET' && path === '/health') return json({ status: 'ok', service: 'OPTRANE Lovable Gateway', api: 'itrain-api', version: '0.5.2' });

  // Website account endpoints. The Tauri app does not collect passwords; these are for the OPTRANE website.
  if (req.method === 'POST' && path === '/auth/register') {
    const input = await body<any>(req);
    const email = String(input.email ?? '').trim().toLowerCase();
    const password = String(input.password ?? '');
    if (!email || password.length < 8) throw new HttpError(422, 'Valid email and password (8+ chars) are required', 'registration_input_invalid');
    const client = publicAuthClient();
    const requestedReturn = String(input.returnTo ?? input.return_to ?? '/').trim();
    const safeReturn = requestedReturn.startsWith('/') && !requestedReturn.startsWith('//') ? requestedReturn : '/';
    const base = (Deno.env.get('OPTRANE_WEB_BASE') ?? url.origin).replace(/\/$/, '');
    const redirectTo = `${base}/auth?returnTo=${encodeURIComponent(safeReturn)}`;
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo, data: { display_name: String(input.displayName ?? input.display_name ?? '').slice(0, 120) || undefined } },
    });
    if (error) throw new HttpError(400, error.message, 'registration_failed');
    return json({ userId: data.user?.id, verificationRequired: !data.session, email }, 201);
  }

  if (req.method === 'POST' && path === '/auth/login') {
    const input = await body<any>(req);
    const client = publicAuthClient();
    const { data, error } = await client.auth.signInWithPassword({ email: String(input.email ?? '').trim().toLowerCase(), password: String(input.password ?? '') });
    if (error || !data.session) throw new HttpError(401, error?.message ?? 'Login failed', 'login_failed');
    if (!data.user.email_confirmed_at) throw new HttpError(403, 'Verify your email before signing in', 'email_not_verified');
    return json({
      accessToken: data.session.access_token, refreshToken: data.session.refresh_token,
      expiresIn: data.session.expires_in, tokenType: data.session.token_type,
      user: { id: data.user.id, email: data.user.email, displayName: data.user.user_metadata?.display_name },
    });
  }

  if (req.method === 'POST' && path === '/auth/refresh') {
    const input = await body<any>(req);
    const client = publicAuthClient();
    const { data, error } = await client.auth.refreshSession({ refresh_token: String(input.refreshToken ?? input.refresh_token ?? '') });
    if (error || !data.session) throw new HttpError(401, error?.message ?? 'Session refresh failed', 'refresh_failed');
    return json({ accessToken: data.session.access_token, refreshToken: data.session.refresh_token, expiresIn: data.session.expires_in, tokenType: data.session.token_type });
  }

  // Browser-to-desktop verification bridge. The deep link never carries an access token.
  if (req.method === 'POST' && path === '/desktop-auth/start') {
    const input = await body<any>(req).catch(() => ({}));
    const verifier = randomSecret(32);
    const requestId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const callbackUri = input.callbackUri ?? input.callback_uri ?? 'optrane://auth/callback';
    if (!String(callbackUri).startsWith('optrane://auth/callback')) throw new HttpError(422, 'Invalid desktop callback URI', 'desktop_callback_invalid');
    const { error } = await admin().from('desktop_auth_requests').insert({
      id: requestId,
      verifier_hash: await hashText(verifier),
      callback_uri: callbackUri,
      expires_at: expiresAt,
      device_name: input.deviceName ?? input.device_name ?? null,
      platform: input.platform ?? null,
      app_version: input.appVersion ?? input.app_version ?? null,
    });
    if (error) throw new Error(`desktop auth request: ${error.message}`);
    const origin = Deno.env.get('OPTRANE_WEB_BASE')?.replace(/\/$/, '') ?? url.origin;
    return json({ requestId, verifier, expiresAt, verificationUrl: `${origin}/desktop/verify?request_id=${encodeURIComponent(requestId)}` }, 201);
  }

  let m = path.match(/^\/desktop-auth\/([^/]+)\/status$/);
  if (req.method === 'GET' && m) {
    const verifier = url.searchParams.get('verifier') ?? '';
    const { data: row, error } = await admin().from('desktop_auth_requests').select('id,status,verifier_hash,expires_at').eq('id', m[1]).single();
    if (error || !row) throw new HttpError(404, 'Desktop verification request not found', 'desktop_auth_not_found');
    if (row.verifier_hash !== await hashText(verifier)) throw new HttpError(403, 'Invalid desktop verifier', 'desktop_auth_verifier_invalid');
    if (new Date(row.expires_at).getTime() < Date.now()) return json({ status: 'EXPIRED' });
    return json({ status: row.status });
  }

  if (req.method === 'POST' && path === '/desktop-auth/exchange') {
    const input = await body<any>(req);
    const requestId = input.requestId ?? input.request_id;
    const verifier = String(input.verifier ?? '');
    if (!requestId || !verifier) throw new HttpError(422, 'requestId and verifier are required', 'desktop_auth_exchange_input');
    const { data: row, error } = await admin().from('desktop_auth_requests').select('*').eq('id', requestId).single();
    if (error || !row) throw new HttpError(404, 'Desktop verification request not found', 'desktop_auth_not_found');
    if (row.verifier_hash !== await hashText(verifier)) throw new HttpError(403, 'Invalid desktop verifier', 'desktop_auth_verifier_invalid');
    if (new Date(row.expires_at).getTime() < Date.now()) throw new HttpError(410, 'Desktop verification request expired', 'desktop_auth_expired');
    if (row.status === 'CONSUMED') throw new HttpError(409, 'Desktop verification request was already consumed', 'desktop_auth_consumed');
    if (row.status !== 'APPROVED' || !row.token_hash || !row.user_id) throw new HttpError(409, 'Desktop account verification is not approved yet', 'desktop_auth_not_approved');
    const attempts = Number(row.exchange_attempts ?? 0) + 1;
    if (attempts > 5) throw new HttpError(429, 'Too many desktop exchange attempts', 'desktop_auth_attempts_exceeded');
    await admin().from('desktop_auth_requests').update({ exchange_attempts: attempts, last_exchange_at: new Date().toISOString() }).eq('id', row.id);
    const session = await consumeMagicLinkToken(row.token_hash);
    if (session.user.id !== row.user_id) throw new HttpError(403, 'Desktop session user mismatch', 'desktop_auth_user_mismatch');
    await admin().from('desktop_auth_requests').update({ status: 'CONSUMED', consumed_at: new Date().toISOString(), token_hash: null }).eq('id', row.id);
    return json({
      accessToken: session.session.access_token,
      refreshToken: session.session.refresh_token,
      expiresIn: session.session.expires_in,
      tokenType: session.session.token_type,
      user: { id: session.user.id, email: session.user.email },
    });
  }

  const auth = await requireUser(req);

  m = path.match(/^\/desktop-auth\/([^/]+)\/approve$/);
  if (req.method === 'POST' && m) {
    const { data: row, error } = await admin().from('desktop_auth_requests').select('*').eq('id', m[1]).single();
    if (error || !row) throw new HttpError(404, 'Desktop verification request not found', 'desktop_auth_not_found');
    if (new Date(row.expires_at).getTime() < Date.now()) throw new HttpError(410, 'Desktop verification request expired', 'desktop_auth_expired');
    if (row.status === 'CONSUMED') throw new HttpError(409, 'Desktop verification request was already used', 'desktop_auth_consumed');
    const user = (await admin().auth.getUser(auth.token)).data.user;
    if (!user?.email) throw new HttpError(422, 'Verified account has no email address', 'email_required');
    if (!user.email_confirmed_at) throw new HttpError(403, 'Verify your email before pairing OPTRANE Command', 'email_not_verified');
    const { data: link, error: linkError } = await admin().auth.admin.generateLink({ type: 'magiclink', email: user.email });
    if (linkError) throw new Error(`desktop session link: ${linkError.message}`);
    const tokenHash = (link.properties as any)?.hashed_token;
    if (!tokenHash) throw new Error('Supabase did not return a desktop session token hash');
    await admin().from('desktop_auth_requests').update({
      status: 'APPROVED', user_id: auth.userId, email: user.email, token_hash: tokenHash, approved_at: new Date().toISOString(),
    }).eq('id', row.id);
    return json({ status: 'APPROVED', callbackUri: `${row.callback_uri}?request_id=${encodeURIComponent(row.id)}`, requestId: row.id });
  }

  if (req.method === 'GET' && path === '/auth/me') {
    const { data } = await admin().auth.getUser(auth.token);
    if (!data.user) throw new HttpError(401, 'Invalid session', 'invalid_session');
    return json({ id: data.user.id, email: data.user.email, displayName: data.user.user_metadata?.display_name, emailVerified: Boolean(data.user.email_confirmed_at) });
  }

  if (req.method === 'POST' && path === '/auth/logout') {
    try { await (admin().auth.admin as any).signOut(auth.token, 'local'); } catch { /* client also clears local session */ }
    return noContent();
  }

  if (req.method === 'GET' && path === '/productions') {
    const { data: memberships, error } = await admin().from('production_members').select('production_id').eq('user_id', auth.userId);
    if (error) throw new Error(error.message);
    const ids = (memberships ?? []).map((r) => r.production_id);
    if (!ids.length) return json({ productions: [] });
    const summaries = await Promise.all(ids.map(productionSummary));
    return json({ productions: summaries });
  }

  if (req.method === 'POST' && path === '/productions') {
    const input = await body<any>(req);
    if (!input.title?.trim()) throw new HttpError(422, 'Production title is required', 'title_required');
    const { data: p, error } = await admin().from('productions').insert({ owner_id: auth.userId, title: input.title.trim(), shoot_start: input.shoot_start ?? input.shootStart ?? null, shoot_end: input.shoot_end ?? input.shootEnd ?? null }).select('*').single();
    if (error) throw new Error(`create production: ${error.message}`);
    await admin().from('production_members').insert({ production_id: p.id, user_id: auth.userId, role: 'OWNER' });
    await appendAudit(p.id, 'PRODUCTION_CREATED', 'Producer', `Production ${p.title} created`);
    return json({ productionId: p.id, title: p.title, status: p.status }, 201);
  }

  m = path.match(/^\/productions\/([^/]+)\/summary$/);
  if (req.method === 'GET' && m) { await requireMember(auth.userId, m[1]); return json(await productionSummary(m[1])); }

  m = path.match(/^\/productions\/([^/]+)\/graph$/);
  if (req.method === 'GET' && m) {
    await requireMember(auth.userId, m[1]);
    const { data, error } = await admin().from('production_dependencies').select('*').eq('production_id', m[1]);
    if (error) throw new Error(error.message);
    const nodes = new Map<string, any>();
    const edges: any[] = [];
    for (const d of data ?? []) {
      const source = `${String(d.source_type).toLowerCase()}:${d.source_id}`;
      const target = `${String(d.target_type).toLowerCase()}:${d.target_id}`;
      nodes.set(source, nodes.get(source) ?? { id: source, type: d.source_type, label: d.metadata?.label ?? d.source_id, state: d.state });
      nodes.set(target, nodes.get(target) ?? { id: target, type: d.target_type, label: d.metadata?.label ?? d.target_id, state: d.state });
      edges.push({ source, target, relation: d.relation });
    }
    return json({ nodes: [...nodes.values()], edges });
  }

  m = path.match(/^\/productions\/([^/]+)\/audit$/);
  if (req.method === 'GET' && m) {
    await requireMember(auth.userId, m[1]);
    const { data, error } = await admin().from('audit_events').select('*').eq('production_id', m[1]).order('created_at', { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    return json({ events: data ?? [] });
  }

  m = path.match(/^\/productions\/([^/]+)\/evidence$/);
  if (req.method === 'GET' && m) {
    await requireMember(auth.userId, m[1]);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 200)));
    const kinds = new Set((url.searchParams.get('kinds') ?? 'audit,ai,analysis,delta').split(',').map((v) => v.trim().toLowerCase()));
    const since = url.searchParams.get('since');
    const items: any[] = [];
    if (kinds.has('audit')) {
      let q = admin().from('audit_events').select('*').eq('production_id', m[1]).order('created_at', { ascending: false }).limit(limit);
      if (since) q = q.gte('created_at', since);
      for (const row of (await q).data ?? []) items.push({ id: row.id, kind: 'audit', createdAt: row.created_at, summary: row.summary, source: row.source, payload: row.payload });
    }
    if (kinds.has('analysis')) {
      let q = admin().from('analysis_events').select('*').eq('production_id', m[1]).order('created_at', { ascending: false }).limit(limit);
      if (since) q = q.gte('created_at', since);
      for (const row of (await q).data ?? []) items.push({ id: row.id, kind: 'analysis', createdAt: row.created_at, summary: row.message, source: row.actor, payload: row.payload });
    }
    if (kinds.has('ai')) {
      let q = admin().from('analysis_events').select('*').eq('production_id', m[1]).order('created_at', { ascending: false }).limit(limit);
      if (since) q = q.gte('created_at', since);
      const aiActors = /agent|gemini|google|adk|runtime|mcp|clickhouse/i;
      for (const row of (await q).data ?? []) {
        if (!aiActors.test(String(row.actor ?? '')) && !aiActors.test(String(row.type ?? ''))) continue;
        items.push({ id: `ai-${row.id}`, kind: 'ai', createdAt: row.created_at, summary: row.message, source: row.actor, payload: row.payload });
      }
    }
    if (kinds.has('delta')) {
      let q = admin().from('artifact_deltas').select('*').eq('production_id', m[1]).order('created_at', { ascending: false }).limit(limit);
      if (since) q = q.gte('created_at', since);
      for (const row of (await q).data ?? []) items.push({ id: row.id, kind: 'delta', createdAt: row.created_at, summary: row.title, source: 'OPTRANE', payload: { artifact: { kind: row.kind, title: row.title, lines: row.lines } } });
    }
    items.sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return json({ items: items.slice(0, limit) });
  }

  if (req.method === 'POST' && path === '/scripts/upload') return json(await uploadScript(req, auth.userId), 201);

  if (req.method === 'POST' && path === '/analyses') {
    const input = await body<any>(req);
    const productionId = input.productionId ?? input.production_id;
    const revisionVersion = Number(input.revisionVersion ?? input.revision_version ?? 0);
    if (!productionId || !revisionVersion) throw new HttpError(422, 'productionId and revisionVersion are required', 'analysis_input_required');
    await requireMember(auth.userId, productionId, true);
    const analysis = await createAnalysis(productionId, revisionVersion, auth.userId);
    waitUntil(runAnalysis(analysis.id).catch((error) => console.error('analysis background task failed', error)));
    return json({ analysisId: analysis.id, status: analysis.status }, 202);
  }

  m = path.match(/^\/analyses\/([^/]+)$/);
  if (req.method === 'GET' && m) {
    const payload = await analysisPayload(m[1]);
    await requireMember(auth.userId, payload.productionId);
    return json(payload);
  }

  m = path.match(/^\/analyses\/([^/]+)\/events$/);
  if (req.method === 'GET' && m) {
    const { data: a } = await admin().from('analyses').select('production_id').eq('id', m[1]).single();
    if (!a) throw new HttpError(404, 'Analysis not found', 'analysis_not_found');
    await requireMember(auth.userId, a.production_id);
    return sseResponse(await eventsStream(m[1]));
  }

  m = path.match(/^\/recovery-plans\/([^/]+)\/(approve|reject)$/);
  if (req.method === 'POST' && m) {
    const { data: plan } = await admin().from('recovery_plans').select('production_id').eq('id', m[1]).single();
    if (!plan) throw new HttpError(404, 'Recovery plan not found', 'plan_not_found');
    await requireMember(auth.userId, plan.production_id, true);
    if (m[2] === 'approve') {
      const readiness = await approvePlan(plan.production_id, m[1], auth.userId, 'Producer');
      const { data: artifacts } = await admin().from('artifact_deltas').select('*').eq('plan_id', m[1]);
      return json({ approved: true, readiness, artifacts: artifacts ?? [] });
    }
    const input = await body<any>(req).catch(() => ({}));
    await rejectPlan(plan.production_id, m[1], auth.userId, 'Producer', input.reason);
    return json({ rejected: true });
  }

  if (req.method === 'POST' && path === '/demo/reset') {
    if (!env.demoMode) throw new HttpError(403, 'Demo endpoints are disabled', 'demo_disabled');
    const productionId = await resetNightfall(auth.userId);
    return json({ productionId, dashboard: await productionSummary(productionId) });
  }

  if (req.method === 'POST' && path === '/demo/prepare-recording') {
    if (!env.demoMode) throw new HttpError(403, 'Demo endpoints are disabled', 'demo_disabled');
    const testUser = requireRecordingTestUser(auth);
    const productionId = await resetNightfall(auth.userId);
    await appendAudit(productionId, 'RECORDING_DEMO_PREPARED', 'OPTRANE', 'Recording baseline prepared for verified test account', { testUser, readiness: 94, scriptVersion: 7 });
    return json({ productionId, testUser, dashboard: await productionSummary(productionId) });
  }

  if (req.method === 'POST' && path === '/demo/load-revision') {
    if (!env.demoMode) throw new HttpError(403, 'Demo endpoints are disabled', 'demo_disabled');
    const testUser = requireRecordingTestUser(auth);
    const revision = await loadNightfallRevision(auth.userId);
    await appendAudit(revision.productionId, 'RECORDING_REVISION_STAGED', 'OPTRANE', 'NIGHTFALL v8 staged for recording', { testUser, version: revision.version, changes: 4 });
    return json({ ...revision, testUser, changes: nightfallRevisionPreview(), dashboard: await productionSummary(revision.productionId) });
  }

  if (req.method === 'GET' && path === '/system/integrations') {
    const [clickhouseReachable, runtimeReachable, mcpReachable, governance] = await Promise.all([
      clickhousePing(),
      agentRuntimeReachable(),
      mcpConfigured() ? runClickHouseMcpQuery('SELECT 1 AS ok').then(() => true).catch(() => false) : Promise.resolve(false),
      governanceProviderStatus(),
    ]);
    const ready = (!env.requireMcp || mcpReachable)
      && (!env.requireAgentRuntime || runtimeReachable)
      && (!env.requireGovernance || (governance.connected && governance.reachable))
      && clickhouseReachable;
    return json({
      gemini: { configured: Boolean(env.googleCloudProject), reachable: runtimeReachable, model: env.geminiModel },
      agentRuntime: { configured: agentRuntimeConfigured(), reachable: runtimeReachable, resource: env.googleAgentEngineResource ? 'configured' : undefined, adk: true },
      clickhouse: { configured: clickhouseConfigured(), reachable: clickhouseReachable, database: 'optrane' },
      mcp: { configured: mcpConfigured(), reachable: mcpReachable, tool: 'run_query', readOnly: true },
      governance: {
        configured: governance.configured,
        reachable: governance.reachable,
        connected: governance.connected,
        provider: governance.provider,
        status: governance.status,
      },
      strictMode: { requireMcp: env.requireMcp, requireAgentRuntime: env.requireAgentRuntime, requireGovernance: env.requireGovernance, ready },
    });
  }

  if (req.method === 'GET' && path === '/system/governance/status') {
    const governance = await governanceProviderStatus();
    return json({
      connected: governance.connected,
      provider: governance.provider,
      status: governance.status,
      reachable: governance.reachable,
      lastHeartbeatAt: governance.lastHeartbeatAt,
    });
  }

  m = path.match(/^\/productions\/([^/]+)\/agents$/);
  if (req.method === 'GET' && m) {
    await requireMember(auth.userId, m[1]);
    const { data, error } = await admin().from('production_agents').select('*').eq('production_id', m[1]).order('created_at');
    if (error) throw new Error(error.message);
    return json({ agents: (data ?? []).map(normalizeAgent) });
  }

  m = path.match(/^\/productions\/([^/]+)\/agents\/register$/);
  if (req.method === 'POST' && m) return json({ agent: await registerAgent(auth.userId, m[1], await body<any>(req)) }, 201);

  m = path.match(/^\/productions\/([^/]+)\/agents\/register-fleet$/);
  if (req.method === 'POST' && m) {
    await requireMember(auth.userId, m[1], true);
    const input = await body<any>(req).catch(() => ({}));
    const requested = input.templates ?? defaultFleet.filter((t) => !input.agentTypes?.length || input.agentTypes.includes(t.agentType));
    const agents = [];
    for (const template of requested) agents.push(await registerAgent(auth.userId, m[1], { ...template, runtime: template.runtime ?? 'GOOGLE_ADK', model: template.model ?? 'gemini-3.5-flash' }));
    return json({ agents }, 201);
  }

  m = path.match(/^\/productions\/([^/]+)\/agents\/([^/]+)$/);
  if (req.method === 'GET' && m) {
    await requireMember(auth.userId, m[1]);
    const { data, error } = await admin().from('production_agents').select('*').eq('production_id', m[1]).eq('id', m[2]).single();
    if (error || !data) throw new HttpError(404, 'Agent not found', 'agent_not_found');
    const normalized = normalizeAgent(data);
    const budgetState = await improvementBudgetState(data);
    if (normalized.selfImprovement) normalized.selfImprovement.budget = {
      ...normalized.selfImprovement.budget,
      spentToday: budgetState.dailySpent,
      remainingToday: budgetState.remainingDaily,
      iterationsToday: budgetState.dailyIterations,
    };
    return json({ agent: normalized });
  }

  m = path.match(/^\/productions\/([^/]+)\/agents\/([^/]+)\/(sync|retry-registration|revoke)$/);
  if (req.method === 'POST' && m) {
    await requireMember(auth.userId, m[1], true);
    const { data: local } = await admin().from('production_agents').select('*').eq('production_id', m[1]).eq('id', m[2]).single();
    if (!local) throw new HttpError(404, 'Agent not found', 'agent_not_found');
    if (m[3] === 'revoke') {
      const input = await body<any>(req).catch(() => ({}));
      if (local.agentcess_agent_id) await agentcessRequest(`/v1/agents/${encodeURIComponent(local.agentcess_agent_id)}/revoke`, { method: 'POST', body: JSON.stringify({ reason: input.reason ?? 'Revoked in OPTRANE' }) });
      const { data } = await admin().from('production_agents').update({ status: 'REVOKED', trust_status: 'REVOKED', updated_at: new Date().toISOString() }).eq('id', local.id).select('*').single();
      await appendAudit(m[1], 'AGENT_REVOKED', 'Producer', `${local.name} revoked`, { localAgentId: local.id });
      return json({ agent: normalizeAgent(data) });
    }
    if (m[3] === 'retry-registration' && !local.agentcess_agent_id) {
      await admin().from('production_agents').delete().eq('id', local.id);
      return json({ agent: await registerAgent(auth.userId, m[1], {
        name: local.name, agentType: local.agent_type, purpose: local.purpose, runtime: local.runtime, model: local.model,
        capabilities: local.capabilities, tools: local.tools, dataClasses: local.data_classes, budget: local.budget,
        selfImprovement: { ...(local.self_improvement_policy ?? {}), budget: local.self_improvement_budget ?? {} },
      }) });
    }
    if (!local.agentcess_agent_id) throw new HttpError(409, 'Governance passport is not provisioned', 'passport_missing');
    const remote = await agentcessRequest<any>(`/v1/agents/${encodeURIComponent(local.agentcess_agent_id)}/passport`);
    const update = {
      agentcess_passport_version: remote.passportVersion ?? remote.passport_version ?? remote.passport?.version ?? local.agentcess_passport_version,
      trust_status: remote.trustStatus ?? remote.trust_status ?? remote.status ?? local.trust_status,
      trust_score: remote.trustScore ?? remote.trust_score ?? local.trust_score,
      last_agentcess_sync_at: new Date().toISOString(),
      status: ['REVOKED','RESTRICTED'].includes(remote.status) ? remote.status : local.status,
      updated_at: new Date().toISOString(),
    };
    const { data } = await admin().from('production_agents').update(update).eq('id', local.id).select('*').single();
    return json({ agent: normalizeAgent(data) });
  }

  m = path.match(/^\/productions\/([^/]+)\/agents\/([^/]+)\/runs$/);
  if (m && req.method === 'GET') {
    await requireMember(auth.userId, m[1]);
    const { data } = await admin().from('agent_runs').select('*').eq('production_id', m[1]).eq('agent_id', m[2]).order('created_at', { ascending: false });
    return json({ runs: (data ?? []).map((row) => ({
      id: row.id, externalRunId: row.external_run_id, agentId: row.agent_id, governanceRunId: row.agentcess_run_id,
      purpose: row.purpose, status: row.status, budgetLimit: Number(row.budget_limit ?? 0), spent: Number(row.spent ?? 0),
      startedAt: row.started_at, completedAt: row.completed_at,
    })) });
  }
  if (m && req.method === 'POST') {
    await requireMember(auth.userId, m[1], true);
    const input = await body<any>(req);
    const { data: local } = await admin().from('production_agents').select('*').eq('production_id', m[1]).eq('id', m[2]).single();
    if (!local?.agentcess_agent_id) throw new HttpError(409, 'Governance passport is required', 'passport_missing');
    if (['REVOKED','RESTRICTED'].includes(local.status)) throw new HttpError(403, 'Agent is not cleared for new runs', 'agent_not_cleared');
    const configuredPerRun = Number(local.budget?.perRun ?? local.budget?.per_run ?? 0);
    const requestedMaximum = Number(input.budget?.maximum ?? configuredPerRun);
    if (requestedMaximum <= 0 || requestedMaximum > configuredPerRun) throw new HttpError(403, 'Requested run budget exceeds the configured per-run cap', 'run_budget_exceeded');
    const externalRunId = crypto.randomUUID();
    const remote = await agentcessRequest<any>('/v1/agent-runs', { method: 'POST', body: JSON.stringify({
      agentId: local.agentcess_agent_id,
      externalRunId,
      purpose: input.purpose,
      budget: { currency: local.budget?.currency ?? 'USD', maximum: requestedMaximum },
    }) });
    const { data, error } = await admin().from('agent_runs').insert({
      production_id: m[1], agent_id: m[2], external_run_id: externalRunId,
      agentcess_run_id: remote.runId ?? remote.run_id ?? remote.id, purpose: input.purpose,
      status: remote.status ?? 'ACTIVE', budget_limit: requestedMaximum, spent: remote.spent ?? 0,
      payload: { providerStatus: remote.status ?? 'ACTIVE' },
    }).select('*').single();
    if (error) throw new Error(error.message);
    return json({ run: {
      id: data.id, externalRunId: data.external_run_id, agentId: data.agent_id, governanceRunId: data.agentcess_run_id,
      purpose: data.purpose, status: data.status, budgetLimit: Number(data.budget_limit ?? 0), spent: Number(data.spent ?? 0), startedAt: data.started_at,
    } }, 201);
  }

  m = path.match(/^\/productions\/([^/]+)\/agents\/([^/]+)\/authorize$/);
  if (req.method === 'POST' && m) {
    await requireMember(auth.userId, m[1], true);
    const input = await body<any>(req);
    const { data: local } = await admin().from('production_agents').select('*').eq('production_id', m[1]).eq('id', m[2]).single();
    if (!local?.agentcess_agent_id) throw new HttpError(409, 'Governance passport is required', 'passport_missing');
    if (['REVOKED','RESTRICTED'].includes(local.status)) return json({ decision: 'DENY', reason: `Agent status is ${local.status}` });
    const providerPayload = {
      agentId: local.agentcess_agent_id,
      runId: input.runId ?? input.run_id,
      action: input.action,
      tool: input.tool,
      resource: input.resource,
      dataClasses: input.dataClasses ?? input.data_classes ?? [],
      estimatedCost: input.estimatedCost ?? input.estimated_cost,
    };
    const decision = await agentcessRequest<any>('/v1/authorizations/check', { method: 'POST', body: JSON.stringify(providerPayload) });
    const { data: evidenceRow } = await admin().from('agent_evidence').insert({
      production_id: m[1], agent_id: m[2], run_id: input.localRunId ?? input.local_run_id ?? null,
      event_type: 'AUTHORIZATION', tool: input.tool, decision: decision.decision,
      success: decision.decision === 'ALLOW', summary: decision.reason ?? `Governance decision: ${decision.decision}`,
      payload: { action: input.action, resource: input.resource, remainingBudget: decision.remainingBudget ?? decision.remaining_budget },
    }).select('id').single();
    return json({
      decision: decision.decision,
      approvalId: decision.approvalId ?? decision.approval_id,
      remainingBudget: decision.remainingBudget ?? decision.remaining_budget,
      reason: decision.reason,
      evidenceId: evidenceRow?.id,
    });
  }

  m = path.match(/^\/productions\/([^/]+)\/agents\/([^/]+)\/evidence$/);
  if (m && req.method === 'GET') {
    await requireMember(auth.userId, m[1]);
    const { data } = await admin().from('agent_evidence').select('id,agent_id,run_id,event_type,tool,decision,success,summary,created_at').eq('production_id', m[1]).eq('agent_id', m[2]).order('created_at', { ascending: false }).limit(500);
    return json({ evidence: data ?? [] });
  }
  if (m && req.method === 'POST') {
    await requireMember(auth.userId, m[1], true);
    const input = await body<any>(req);
    if ((input.eventType ?? input.event_type) !== 'USER_NOTE') throw new HttpError(403, 'Desktop clients may only append USER_NOTE evidence annotations', 'evidence_write_restricted');
    const { data, error } = await admin().from('agent_evidence').insert({
      production_id: m[1], agent_id: m[2], run_id: input.runId ?? input.run_id ?? null,
      event_type: 'USER_NOTE', summary: String(input.summary ?? input.message ?? '').slice(0, 1000),
      payload: { source: 'USER' },
    }).select('id,agent_id,run_id,event_type,tool,decision,success,summary,created_at').single();
    if (error) throw new Error(error.message);
    return json({ evidence: data }, 201);
  }

  m = path.match(/^\/productions\/([^/]+)\/agents\/([^/]+)\/improvements$/);
  if (m && req.method === 'GET') {
    await requireMember(auth.userId, m[1]);
    const { data } = await admin().from('agent_improvement_candidates').select('*').eq('production_id', m[1]).eq('agent_id', m[2]).order('created_at', { ascending: false }).limit(100);
    return json({ items: data ?? [] });
  }

  m = path.match(/^\/productions\/([^/]+)\/agents\/([^/]+)\/improvements\/propose$/);
  if (m && req.method === 'POST') {
    await requireMember(auth.userId, m[1], true);
    const input = await body<any>(req).catch(() => ({}));
    const { data: agent } = await admin().from('production_agents').select('*').eq('production_id', m[1]).eq('id', m[2]).single();
    if (!agent) throw new HttpError(404, 'Agent not found', 'agent_not_found');
    const candidate = await proposeImprovement({ userId: auth.userId, productionId: m[1], agent, runId: input.runId ?? input.run_id, evidence: input.evidence ?? {} });
    await appendAudit(m[1], 'AGENT_SELF_IMPROVEMENT_PROPOSED', 'Agent', `${agent.name} proposed a bounded self-improvement candidate`, { agentId: agent.id, candidateId: candidate.id, type: candidate.type });
    return json({ improvement: candidate }, 201);
  }

  m = path.match(/^\/productions\/([^/]+)\/agents\/([^/]+)\/improvements\/([^/]+)\/(approve|reject)$/);
  if (m && req.method === 'POST') {
    await requireMember(auth.userId, m[1], true);
    const { data: agent } = await admin().from('production_agents').select('*').eq('production_id', m[1]).eq('id', m[2]).single();
    if (!agent) throw new HttpError(404, 'Agent not found', 'agent_not_found');
    const improvement = await decideImprovement({ userId: auth.userId, productionId: m[1], agent, candidateId: m[3], decision: m[4] as 'approve' | 'reject' });
    await appendAudit(m[1], m[4] === 'approve' ? 'AGENT_SELF_IMPROVEMENT_PROMOTED' : 'AGENT_SELF_IMPROVEMENT_REJECTED', 'Producer', `${agent.name} self-improvement ${m[4] === 'approve' ? 'promoted' : 'rejected'}`, { agentId: agent.id, candidateId: m[3] });
    return json({ improvement });
  }

  throw new HttpError(404, `Route not found: ${req.method} ${path}`, 'route_not_found');
}

Deno.serve(async (req) => {
  try { return await handle(req); }
  catch (error) { return toErrorResponse(error); }
});
