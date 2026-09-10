import type {
  AnalysisResult, ArtifactDelta, AuditEvent, GraphResponse, IntegrationHealth, ProductionAgent,
  ProductionSummary, RecoveryPlan, RegisterAgentInput, AgentRun, AgentEvidence, ImprovementCandidate,
  ResearchBrief, ResearchRisk, ResearchSource, ScriptChange,
} from '../types/optrane';
import { getOptraneApiBase } from '../config/optrane';
import { explainGatewayFailure, publicGatewayHeaders } from './gateway';
import { optraneFetch } from './optraneFetch';
import { ensureAccessToken, loadDeviceToken, refreshDesktopSession } from './session';

export function apiBase() {
  return getOptraneApiBase();
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public path: string, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

type Envelope<T> = { data: T; meta?: Record<string, unknown> } | T;

async function authHeaders() {
  const token = await ensureAccessToken();
  const deviceToken = await loadDeviceToken();
  return publicGatewayHeaders({
    Authorization: `Bearer ${token}`,
    ...(deviceToken ? { 'X-OPTRANE-Device-Token': deviceToken } : {}),
  });
}

function unwrap<T>(value: Envelope<T>): T {
  if (value && typeof value === 'object' && 'data' in value) return (value as { data: T }).data;
  return value as T;
}

async function parseError(response: Response, path: string): Promise<ApiError> {
  let message = `${response.status} ${response.statusText}`;
  let code: string | undefined;
  try {
    const body = await response.json() as {
      detail?: string;
      code?: string;
      error?: string | { message?: string; code?: string };
    };
    if (typeof body.error === 'string') message = body.error;
    else message = body.error?.message ?? body.detail ?? message;
    code = typeof body.error === 'object' ? body.error?.code : body.code;
    if (response.status === 401) {
      message = explainGatewayFailure(401, message);
    } else if (response.status === 429) {
      message = 'Research rate limit reached (20 requests/minute). Wait a moment and try again.';
    } else if (response.status === 403 && message === `${response.status} ${response.statusText}`) {
      message = 'You do not have permission for this production action.';
    } else if (response.status === 404 && message === `${response.status} ${response.statusText}`) {
      message = 'The requested OPTRANE resource was not found.';
    } else if (/unknown route/i.test(message)) {
      message = `This OPTRANE gateway route is not available yet (${path}).`;
    } else if (response.status >= 500 && message === `${response.status} ${response.statusText}`) {
      message = 'OPTRANE gateway error. Try again in a moment.';
    }
  } catch { /* keep HTTP error */ }
  return new ApiError(response.status, message, path, code);
}

function normalizeUploadedScript(value: any, productionId: string, kind: string, filename: string): UploadedScript {
  const version = value?.version && typeof value.version === 'object' ? value.version : value;
  return {
    productionId: value.productionId ?? value.production_id ?? version.production_id ?? productionId,
    version: Number(
      value.version ?? value.scriptVersion ?? value.script_version
      ?? (typeof version.version === 'number' ? version.version : undefined)
      ?? 0,
    ),
    filename: value.filename ?? version.filename ?? version.label ?? filename,
    kind: value.kind ?? kind,
  };
}

function usesHostedGateway() {
  return /lovable\.app/i.test(apiBase());
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function request<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const multipart = init?.body instanceof FormData || init?.body instanceof Blob;
  const headers: Record<string, string> = {
    ...(multipart ? {} : { 'Content-Type': 'application/json' }),
    ...(await authHeaders()),
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (multipart) delete headers['Content-Type'];
  const response = await optraneFetch(`${apiBase()}${path}`, {
    ...init,
    headers,
  });
  if (response.status === 401 && !retried) {
    try {
      await refreshDesktopSession();
      return request<T>(path, init, true);
    } catch {
      throw await parseError(response, path);
    }
  }
  if (!response.ok) throw await parseError(response, path);
  if (response.status === 204) return undefined as T;
  return unwrap(await response.json() as Envelope<T>);
}

async function optionalRequest<T>(path: string, fallback: T, init?: RequestInit): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || /unknown route/i.test(error.message))) {
      return fallback;
    }
    throw error;
  }
}

function normalizeResearchRisk(value: any, index: number): ResearchRisk {
  return {
    id: String(value.id ?? value.riskId ?? value.risk_id ?? index),
    title: value.title ?? value.label ?? value.category ?? 'Risk',
    severity: String(value.severity ?? value.level ?? 'medium').toLowerCase(),
    mitigation: value.mitigation ?? value.recommendation ?? value.action ?? '',
    detail: value.detail ?? value.description ?? value.reason,
  };
}

function normalizeResearchSource(value: any, index: number): ResearchSource {
  return {
    id: String(value.id ?? value.sourceId ?? value.source_id ?? index),
    title: value.title ?? value.name ?? value.url ?? 'Source',
    url: value.url ?? value.href ?? '#',
    snippet: value.snippet ?? value.excerpt ?? value.summary,
    provider: value.provider ?? value.source ?? (value.parallel ? 'Parallel' : undefined),
  };
}

function normalizeResearchBrief(value: any): ResearchBrief {
  const record = value?.brief ?? value;
  return {
    id: String(record.id ?? record.briefId ?? record.brief_id ?? record.researchId ?? record.research_id ?? crypto.randomUUID()),
    productionId: String(record.productionId ?? record.production_id ?? ''),
    question: record.question ?? '',
    summary: record.summary ?? record.answer ?? record.brief ?? '',
    sceneNumber: record.sceneNumber ?? record.scene_number,
    context: record.context,
    parallelSearchId: record.parallelSearchId ?? record.parallel_search_id,
    reasoningBackend: record.reasoningBackend ?? record.reasoning_backend ?? record.backend ?? record.model,
    risks: (record.risks ?? record.findings ?? []).map(normalizeResearchRisk),
    sources: (record.sources ?? record.citations ?? []).map(normalizeResearchSource),
    createdAt: record.createdAt ?? record.created_at,
  };
}

function normalizeProduction(value: any): ProductionSummary {
  const record = value?.production && typeof value.production === 'object' ? value.production : value;
  return {
    productionId: record.productionId ?? record.production_id ?? record.id,
    title: record.title ?? record.name ?? 'Untitled Production',
    readiness: record.readiness ?? record.readiness_score ?? record.currentReadiness ?? record.current_readiness ?? 0,
    scenes: record.scenes ?? record.sceneCount ?? record.scene_count ?? 0,
    crew: record.crew ?? record.crewCount ?? record.crew_count ?? 0,
    cast: record.cast ?? record.castCount ?? record.cast_count ?? 0,
    locations: record.locations ?? record.locationCount ?? record.location_count ?? 0,
    plannedCost: record.plannedCost ?? record.planned_cost ?? 0,
    currentScriptVersion: record.currentScriptVersion ?? record.current_script_version ?? 0,
    riskCounts: record.riskCounts ?? record.risk_counts ?? {
      CRITICAL: record.criticalCount ?? record.critical_count ?? 0,
      HIGH: record.highCount ?? record.high_count ?? 0,
      WATCH: record.watchCount ?? record.watch_count ?? 0,
    },
    shootDayLabel: record.shootDayLabel ?? record.shoot_day_label ?? record.status ?? 'Production active',
  };
}



function normalizeAnalysis(value: any): AnalysisResult {
  return {
    analysisId: value.analysisId ?? value.analysis_id ?? value.id,
    status: value.status === 'COMPLETED' ? 'COMPLETE' : value.status,
    revisionVersion: Number(value.revisionVersion ?? value.revision_version ?? value.to_script_version ?? 0),
    changes: (value.changes ?? value.script_changes ?? []).map((item: any) => ({
      id: item.id,
      scene: String(item.scene ?? item.scene_id ?? item.scene_number ?? ''),
      type: item.type ?? item.change_type,
      category: item.category ?? '',
      label: item.label ?? item.newValue ?? item.new_value ?? item.description ?? item.category ?? item.change_type,
      ignored: item.ignored ?? false,
    })),
    impacts: (value.impacts ?? value.impact_findings ?? value.findings ?? []).map((item: any) => ({
      id: item.id,
      category: item.category,
      severity: item.severity === 'MEDIUM' ? 'WATCH' : item.severity,
      rawSeverity: item.rawSeverity ?? item.raw_severity ?? item.severity,
      status: item.status,
      reason: item.reason,
      evidence: typeof item.evidence === 'string' ? item.evidence : (item.evidence?.summary ?? item.evidence_summary ?? ''),
      evidenceRefs: item.evidenceRefs ?? item.evidence_refs,
    })),
    readinessBefore: Number(value.readinessBefore ?? value.readiness_before ?? 0),
    readinessAfter: Number(value.readinessAfter ?? value.readiness_after ?? 0),
  };
}

function normalizeRecoveryPlan(item: any): RecoveryPlan {
  return {
    id: item.id,
    code: item.code ?? item.planKey ?? item.plan_key,
    title: item.title,
    costDelta: Number(item.costDelta ?? item.estimated_cost_delta ?? item.estimatedCostDelta ?? 0),
    scheduleDeltaMinutes: Number(item.scheduleDeltaMinutes ?? item.estimated_schedule_delta_minutes ?? item.estimatedScheduleDeltaMinutes ?? 0),
    risk: item.risk ?? 'MEDIUM',
    changes: Number(item.changes ?? item.operations?.length ?? 0),
    recommended: item.recommended ?? false,
    actions: item.actions ?? (item.operations ?? []).map((operation: any) => operation.label ?? operation.type ?? 'Operation'),
    assumptions: item.assumptions ?? [],
    unresolved: item.unresolved ?? [],
  };
}

function normalizeRun(item: any): AgentRun {
  return {
    id: item.id,
    externalRunId: item.externalRunId ?? item.external_run_id,
    agentId: item.agentId ?? item.agent_id,
    governanceRunId: item.governanceRunId ?? item.governance_run_id,
    purpose: item.purpose ?? 'Agent run',
    status: item.status,
    budgetLimit: item.budgetLimit ?? item.budget_limit ?? item.budget?.maximum,
    spent: item.spent ?? item.cost ?? item.spend,
    startedAt: item.startedAt ?? item.started_at,
    completedAt: item.completedAt ?? item.completed_at,
  };
}

function normalizeEvidence(item: any): AgentEvidence {
  return {
    id: item.id,
    agentId: item.agentId ?? item.agent_id,
    runId: item.runId ?? item.run_id,
    eventType: item.eventType ?? item.event_type ?? 'EVENT',
    tool: item.tool,
    decision: item.decision ?? item.authorization_decision,
    success: item.success ?? item.result?.success,
    summary: item.summary ?? item.message ?? item.result?.summary ?? 'Governance evidence event',
    createdAt: item.createdAt ?? item.created_at ?? new Date().toISOString(),
  };
}

function normalizeImprovement(item: any): ImprovementCandidate {
  return {
    id: item.id,
    agentId: item.agentId ?? item.agent_id,
    runId: item.runId ?? item.run_id,
    type: item.type,
    currentValue: item.currentValue ?? item.current_value,
    proposedValue: item.proposedValue ?? item.proposed_value,
    rationale: item.rationale,
    evidence: item.evidence ?? {},
    estimatedCost: Number(item.estimatedCost ?? item.estimated_cost ?? 0),
    actualCost: item.actualCost ?? item.actual_cost,
    status: item.status,
    createdAt: item.createdAt ?? item.created_at ?? new Date().toISOString(),
    approvedAt: item.approvedAt ?? item.approved_at,
  };
}

function normalizeAgent(value: any): ProductionAgent {
  const capabilities = (value.capabilities ?? []).map((item: any) => typeof item === 'string'
    ? { capability: item }
    : { capability: item.capability ?? item.name, description: item.description, status: item.status });
  const tools = (value.tools ?? []).map((item: any) => ({
    toolKey: item.toolKey ?? item.tool_key ?? item.key,
    provider: item.provider ?? item.tool_provider ?? 'UNKNOWN',
    accessMode: item.accessMode ?? item.access_mode ?? item.access ?? 'READ',
    bindingId: item.bindingId ?? item.binding_id,
  }));
  const dataClasses = (value.dataClasses ?? value.data_classes ?? []).map((item: any) => ({
    dataClass: item.dataClass ?? item.data_class ?? item.name,
    access: item.access,
  }));
  const governanceSource = value.governance ?? value.agentcess ?? null;
  const budget = value.budget ? {
    currency: value.budget.currency ?? 'USD',
    perRun: Number(value.budget.perRun ?? value.budget.per_run ?? 0),
    daily: Number(value.budget.daily ?? 0),
    spentToday: value.budget.spentToday ?? value.budget.spent_today,
    remainingToday: value.budget.remainingToday ?? value.budget.remaining_today,
  } : undefined;
  const improvement = value.selfImprovement ?? value.self_improvement;
  const selfImprovement = improvement ? {
    enabled: improvement.enabled !== false,
    rule: improvement.rule ?? '',
    allowed: improvement.allowed ?? [],
    forbidden: improvement.forbidden ?? [],
    requiresHumanApproval: improvement.requiresHumanApproval ?? improvement.requires_human_approval ?? true,
    budget: {
      currency: improvement.budget?.currency ?? 'USD',
      perIteration: Number(improvement.budget?.perIteration ?? improvement.budget?.per_iteration ?? 0),
      daily: Number(improvement.budget?.daily ?? 0),
      maxIterationsPerRun: Number(improvement.budget?.maxIterationsPerRun ?? improvement.budget?.max_iterations_per_run ?? 0),
      maxDailyIterations: improvement.budget?.maxDailyIterations ?? improvement.budget?.max_daily_iterations,
      spentToday: improvement.budget?.spentToday ?? improvement.budget?.spent_today,
      remainingToday: improvement.budget?.remainingToday ?? improvement.budget?.remaining_today,
      iterationsToday: improvement.budget?.iterationsToday ?? improvement.budget?.iterations_today,
    },
  } : undefined;
  return {
    id: value.id,
    productionId: value.productionId ?? value.production_id,
    name: value.name,
    agentType: value.agentType ?? value.agent_type,
    purpose: value.purpose,
    runtime: value.runtime ?? 'GOOGLE_ADK',
    model: value.model,
    status: value.status,
    parentAgentId: value.parentAgentId ?? value.parent_agent_id,
    capabilities,
    tools,
    dataClasses,
    budget,
    selfImprovement,
    governance: governanceSource ? {
      provider: governanceSource.provider ?? 'Governance',
      passportId: governanceSource.passportId ?? governanceSource.passport_id ?? governanceSource.agentId ?? governanceSource.agent_id ?? undefined,
      passportVersion: governanceSource.passportVersion ?? governanceSource.passport_version ?? governanceSource.policy?.version ?? '—',
      trustStatus: governanceSource.trustStatus ?? governanceSource.trust_status ?? 'UNVERIFIED',
      trustScore: governanceSource.trustScore ?? governanceSource.trust_score ?? null,
      lastSyncAt: governanceSource.lastSyncAt ?? governanceSource.last_sync_at ?? governanceSource.lastSync,
    } : null,
    registrationError: value.registrationError ?? value.registration_error,
    createdAt: value.createdAt ?? value.created_at,
  };
}

export interface UploadedScript {
  productionId: string;
  version: number;
  filename: string;
  kind?: 'BASELINE' | 'REVISION';
}

export interface EvidenceTrailItem {
  id: string;
  kind: string;
  createdAt: string;
  summary: string;
  source?: string;
  payload?: Record<string, any>;
}

export interface AuthorizationDecision {
  decision: 'ALLOW' | 'DENY' | 'HOLD_FOR_APPROVAL' | string;
  evidenceId?: string;
  approvalId?: string;
  remainingBudget?: number;
  reason?: string;
}

async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await optraneFetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData || init?.body instanceof Blob ? {} : { 'Content-Type': 'application/json' }),
      'x-optrane-client': 'desktop',
      ...init?.headers,
    },
  });
  if (!response.ok) throw await parseError(response, path);
  if (response.status === 204) return undefined as T;
  return unwrap(await response.json() as Envelope<T>);
}

export async function authorizedFetch(input: string, init?: RequestInit) {
  const multipart = init?.body instanceof FormData || init?.body instanceof Blob;
  const headers: Record<string, string> = {
    ...(await authHeaders()),
    'x-optrane-client': 'desktop',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (multipart) delete headers['Content-Type'];
  return optraneFetch(input, { ...init, headers });
}

async function uploadScriptJsonBinary(
  productionId: string,
  file: File,
  kind: 'BASELINE' | 'REVISION',
  onProgress: (value: number) => void,
  signal?: AbortSignal,
  retried = false,
): Promise<UploadedScript> {
  if (file.size > 15 * 1024 * 1024) {
    throw new ApiError(422, 'PDF exceeds the 15 MB upload limit for the hosted OPTRANE gateway.', '/scripts/upload', 'file_too_large');
  }

  onProgress(8);
  if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');

  const content = await fileToBase64(file);
  onProgress(45);
  if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');

  const value = await request<any>('/scripts/upload', {
    method: 'POST',
    body: JSON.stringify({
      production_id: productionId,
      productionId,
      kind,
      filename: file.name,
      content_type: file.type || 'application/pdf',
      content,
      encoding: 'base64',
      label: kind,
    }),
    signal,
  }, retried);

  onProgress(100);
  return normalizeUploadedScript(value, productionId, kind, file.name);
}

async function uploadScriptMultipart(
  productionId: string,
  file: File,
  kind: 'BASELINE' | 'REVISION',
  onProgress: (value: number) => void,
  signal?: AbortSignal,
  retried = false,
): Promise<UploadedScript> {
  if (usesHostedGateway()) {
    try {
      return await uploadScriptJsonBinary(productionId, file, kind, onProgress, signal, retried);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && !retried) {
        await refreshDesktopSession();
        return uploadScriptJsonBinary(productionId, file, kind, onProgress, signal, true);
      }
      throw error;
    }
  }

  const form = new FormData();
  form.append('productionId', productionId);
  form.append('production_id', productionId);
  form.append('kind', kind);
  form.append('file', file, file.name);

  onProgress(8);
  const headers: Record<string, string> = {
    ...(await authHeaders()),
    'x-optrane-client': 'desktop',
  };
  delete headers['Content-Type'];

  let response: Response;
  try {
    response = await optraneFetch(`${apiBase()}/scripts/upload`, {
      method: 'POST',
      headers,
      body: form,
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('Script upload failed before the OPTRANE gateway responded.');
  }

  onProgress(85);

  if (response.status === 401 && !retried) {
    try {
      await refreshDesktopSession();
      return uploadScriptMultipart(productionId, file, kind, onProgress, signal, true);
    } catch {
      throw new ApiError(401, 'Session expired. Use Disconnect on the sidebar, then pair again.', '/scripts/upload');
    }
  }

  if (!response.ok) throw await parseError(response, '/scripts/upload');

  let body: Record<string, unknown> = {};
  try {
    body = await response.json() as Record<string, unknown>;
  } catch { /* empty body */ }
  const value = (body && typeof body === 'object' && 'data' in body ? body.data : body) as Record<string, unknown>;
  onProgress(100);
  return normalizeUploadedScript(value, productionId, kind, file.name);
}

export async function uploadScriptWithProgress(
  productionId: string,
  file: File,
  kind: 'BASELINE' | 'REVISION',
  onProgress: (value: number) => void,
  signal?: AbortSignal,
): Promise<UploadedScript> {
  return uploadScriptMultipart(productionId, file, kind, onProgress, signal);
}

export async function uploadScriptContent(
  productionId: string,
  input: { title: string; content: string; label?: string; scriptId?: string },
  kind: 'BASELINE' | 'REVISION',
  onProgress?: (value: number) => void,
): Promise<UploadedScript> {
  onProgress?.(10);
  const value = await request<any>('/scripts/upload', {
    method: 'POST',
    body: JSON.stringify({
      production_id: productionId,
      productionId,
      title: input.title,
      content: input.content,
      label: input.label ?? kind,
      script_id: input.scriptId,
      kind,
    }),
  });
  onProgress?.(100);
  return normalizeUploadedScript(value, productionId, kind, input.title);
}

function normalizeEvidenceTrail(value: any): EvidenceTrailItem[] {
  const rows = Array.isArray(value) ? value : value.items ?? value.evidence ?? value.events ?? [];
  return rows.map((item: any) => ({
    id: item.id ?? crypto.randomUUID(),
    kind: item.kind ?? item.eventType ?? item.event_type ?? item.type ?? 'evidence',
    createdAt: item.createdAt ?? item.created_at ?? item.time ?? new Date().toISOString(),
    summary: item.summary ?? item.message ?? item.title ?? item.kind ?? 'Evidence event',
    source: item.source,
    payload: item.payload ?? item.data ?? item.delta ?? {},
  }));
}

function normalizeAudit(value: any): { events: AuditEvent[] } {
  const rows = Array.isArray(value) ? value : value.events ?? value.audit ?? [];
  return { events: rows.map((e: any) => ({
    id: e.id ?? crypto.randomUUID(),
    time: e.time ?? new Date(e.createdAt ?? e.created_at ?? Date.now()).toLocaleTimeString('en-GB', { hour12: false }),
    eventType: e.eventType ?? e.event_type ?? e.type ?? 'EVENT',
    actor: e.actor ?? e.user ?? 'OPTRANE',
    summary: e.summary ?? e.message ?? e.eventType ?? e.event_type ?? 'Audit event',
    source: e.source,
    payload: e.payload ?? {},
  })) };
}


async function getEvidenceTrailRequest(productionId: string, options: { limit?: number; since?: string; kinds?: string[] } = {}): Promise<EvidenceTrailItem[]> {
  const params = new URLSearchParams();
  params.set('limit', String(options.limit ?? 200));
  if (options.since) params.set('since', options.since);
  if (options.kinds?.length) params.set('kinds', options.kinds.join(','));
  return request<any>(`/productions/${productionId}/evidence?${params}`).then(normalizeEvidenceTrail);
}

export const api = {
  // Health is intentionally the only unauthenticated desktop endpoint.
  health: () => publicRequest<{ service?: string; status: string }>('/health'),

  listProductions: () => request<any>('/productions').then((value: any) => (Array.isArray(value) ? value : value.productions ?? value.items ?? []).map(normalizeProduction)),
  createProduction: async (body: { title: string; shoot_start: string; shoot_end: string }) => {
    const value = await request<any>('/productions', {
      method: 'POST',
      body: JSON.stringify({
        name: body.title,
        title: body.title,
        shoot_start: body.shoot_start,
        shoot_end: body.shoot_end,
        shootStart: body.shoot_start,
        shootEnd: body.shoot_end,
      }),
    });
    const production = value.production ?? value;
    const production_id = value.production_id ?? value.productionId ?? production.id ?? value.id;
    if (!production_id) throw new Error('OPTRANE created a production without returning its ID.');
    return {
      production_id,
      title: production.title ?? production.name ?? body.title,
      status: production.status ?? value.status ?? 'SETUP',
    };
  },
  getDashboard: (productionId: string) => request<any>(`/productions/${productionId}/summary`).then((value: any) => normalizeProduction(value)),
  getGraph: (productionId: string) => request<GraphResponse>(`/productions/${productionId}/graph`),
  getAudit: (productionId: string) => request<any>(`/productions/${productionId}/audit`).then(normalizeAudit),
  getEvidenceTrail: getEvidenceTrailRequest,

  uploadScript: (productionId: string, file: File, kind: 'BASELINE' | 'REVISION', onProgress: (value: number) => void, signal?: AbortSignal) =>
    uploadScriptWithProgress(productionId, file, kind, onProgress, signal),
  uploadScriptContent: (productionId: string, input: { title: string; content: string; label?: string; scriptId?: string }, kind: 'BASELINE' | 'REVISION', onProgress?: (value: number) => void) =>
    uploadScriptContent(productionId, input, kind, onProgress),

  startAnalysis: (productionId: string, version: number) => request<any>('/analyses', {
    method: 'POST',
    body: JSON.stringify({ productionId, production_id: productionId, revisionVersion: version, revision_version: version }),
  }).then((value: any) => ({ analysisId: value.analysisId ?? value.analysis_id ?? value.jobId ?? value.job_id ?? value.id, status: value.status })),
  getAnalysis: (_productionId: string, analysisId: string) => request<any>(`/analyses/${analysisId}`).then(normalizeAnalysis),
  getRecoveryPlans: async (_productionId: string, analysisId: string) => {
    const value = await request<any>(`/analyses/${analysisId}`);
    const plans = value.recoveryPlans ?? value.recovery_plans ?? value.plans ?? value.data?.recoveryPlans ?? [];
    return { plans: plans.map(normalizeRecoveryPlan) };
  },
  eventUrl: (_productionId: string, analysisId: string) => `${apiBase()}/analyses/${analysisId}/events`,

  runResearch: (productionId: string, body: { question: string; context?: string; sceneNumber?: string }) =>
    request<any>('/research', {
      method: 'POST',
      body: JSON.stringify({
        production_id: productionId,
        productionId,
        question: body.question,
        context: body.context,
        scene_number: body.sceneNumber,
        sceneNumber: body.sceneNumber,
      }),
    }).then(normalizeResearchBrief),
  listResearch: (productionId: string) =>
    request<any>(`/research/${encodeURIComponent(productionId)}`).then((value: any) => {
      const items = Array.isArray(value) ? value : value.briefs ?? value.items ?? value.history ?? [];
      return items.map(normalizeResearchBrief) as ResearchBrief[];
    }),

  approvePlan: (_productionId: string, planId: string) => request<any>(`/recovery-plans/${planId}/approve`, { method: 'POST', body: '{}' }).then((value: any) => ({
    readiness: Number(value.readiness ?? value.currentReadiness ?? value.current_readiness ?? value.production?.readiness ?? 0),
    approved: value.approved ?? (value.decision ? value.decision === 'APPROVED' : true),
    artifacts: value.artifacts ?? value.deltas ?? [],
  })),
  rejectPlan: (_productionId: string, planId: string, reason?: string) => request<any>(`/recovery-plans/${planId}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }).then((value: any) => ({ rejected: value.rejected ?? (value.decision ? value.decision === 'REJECTED' : true) })),
  getArtifacts: async (productionId: string, _planId: string): Promise<{ artifacts: ArtifactDelta[] }> => {
    const evidence = await getEvidenceTrailRequest(productionId, { kinds: ['delta'], limit: 200 });
    const artifacts = evidence.flatMap((item) => {
      const payload = item.payload ?? {};
      const candidate = payload.artifact ?? payload.delta ?? payload;
      if (!candidate.kind && !candidate.artifact_type) return [];
      return [{
        kind: (candidate.kind ?? candidate.artifact_type) as ArtifactDelta['kind'],
        title: candidate.title ?? item.summary,
        lines: candidate.lines ?? candidate.changes ?? [],
      }];
    });
    return { artifacts };
  },

  integrationHealth: () => request<IntegrationHealth>('/system/integrations'),
  governanceStatus: () => request<any>('/system/governance/status'),

  listAgents: (productionId: string) => request<any>(`/productions/${productionId}/agents`).then((v: any) => (Array.isArray(v) ? v : v.agents ?? v.items ?? []).map(normalizeAgent)),
  registerAgent: (productionId: string, body: RegisterAgentInput) => request<any>(`/productions/${productionId}/agents/register`, { method: 'POST', body: JSON.stringify(body) }).then((v: any) => normalizeAgent(v.agent ?? v.data ?? v)),
  registerFleet: (productionId: string, body: Record<string, unknown> = {}) => request<any>(`/productions/${productionId}/agents/register-fleet`, { method: 'POST', body: JSON.stringify(body) }).then((v: any) => (v.agents ?? v.fleet ?? v.items ?? []).map(normalizeAgent)),
  getAgent: (productionId: string, agentId: string) => request<any>(`/productions/${productionId}/agents/${agentId}`).then((v: any) => normalizeAgent(v.agent ?? v.data ?? v)),
  syncAgent: (productionId: string, agentId: string) => request<any>(`/productions/${productionId}/agents/${agentId}/sync`, { method: 'POST', body: '{}' }).then((v: any) => normalizeAgent(v.agent ?? v)),
  retryAgentRegistration: (productionId: string, agentId: string) => request<any>(`/productions/${productionId}/agents/${agentId}/retry-registration`, { method: 'POST', body: '{}' }).then((v: any) => normalizeAgent(v.agent ?? v)),
  revokeAgent: (productionId: string, agentId: string, reason: string) => request<any>(`/productions/${productionId}/agents/${agentId}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) }).then((v: any) => normalizeAgent(v.agent ?? v)),
  getAgentRuns: (productionId: string, agentId: string) => request<any>(`/productions/${productionId}/agents/${agentId}/runs`).then((v: any) => (Array.isArray(v) ? v : v.runs ?? v.items ?? []).map(normalizeRun)),
  startAgentRun: (productionId: string, agentId: string, body: { purpose: string; budget?: { currency: string; maximum: number } }) => request<any>(`/productions/${productionId}/agents/${agentId}/runs`, { method: 'POST', body: JSON.stringify(body) }).then((v: any) => normalizeRun(v.run ?? v)),
  authorizeAgentAction: (productionId: string, agentId: string, body: Record<string, unknown>) => request<any>(`/productions/${productionId}/agents/${agentId}/authorize`, { method: 'POST', body: JSON.stringify(body) }).then((value: any) => ({
    decision: value.decision,
    evidenceId: value.evidenceId ?? value.evidence_id,
    approvalId: value.approvalId ?? value.approval_id,
    remainingBudget: value.remainingBudget ?? value.remaining_budget,
    reason: value.reason,
  } as AuthorizationDecision)),
  getAgentEvidence: (productionId: string, agentId: string) => request<any>(`/productions/${productionId}/agents/${agentId}/evidence`).then((v: any) => (Array.isArray(v) ? v : v.evidence ?? v.items ?? []).map(normalizeEvidence)),
  postAgentEvidence: (productionId: string, agentId: string, body: Record<string, unknown>) => request<any>(`/productions/${productionId}/agents/${agentId}/evidence`, { method: 'POST', body: JSON.stringify(body) }).then((v: any) => normalizeEvidence(v.evidence ?? v)),
  listAgentImprovements: (productionId: string, agentId: string) => optionalRequest<any>(`/productions/${productionId}/agents/${agentId}/improvements`, { items: [] }).then((v: any) => (v.items ?? v.improvements ?? []).map(normalizeImprovement)),
  proposeAgentImprovement: (productionId: string, agentId: string, body: Record<string, unknown> = {}) => request<any>(`/productions/${productionId}/agents/${agentId}/improvements/propose`, { method: 'POST', body: JSON.stringify(body) }).then((v: any) => normalizeImprovement(v.improvement ?? v)),
  decideAgentImprovement: (productionId: string, agentId: string, candidateId: string, decision: 'approve' | 'reject') => request<any>(`/productions/${productionId}/agents/${agentId}/improvements/${candidateId}/${decision}`, { method: 'POST', body: '{}' }).then((v: any) => normalizeImprovement(v.improvement ?? v)),

  resetDemo: () => request<any>('/demo/reset', { method: 'POST', body: '{}' }).then((value: any) => ({
    productionId: value.productionId ?? value.production_id ?? value.dashboard?.productionId ?? value.dashboard?.production_id ?? value.production?.id,
    dashboard: normalizeProduction(value.dashboard ?? value.production ?? value),
  })),
  prepareRecordingDemo: () => request<any>('/demo/prepare-recording', { method: 'POST', body: '{}' }).then((value: any) => ({
    productionId: value.productionId ?? value.production_id ?? value.dashboard?.productionId ?? value.dashboard?.production_id ?? value.production?.id,
    dashboard: normalizeProduction(value.dashboard ?? value.production ?? value),
    testUser: value.testUser ?? value.test_user,
  })),
  loadRecordingRevision: () => request<any>('/demo/load-revision', { method: 'POST', body: '{}' }).then((value: any) => ({
    productionId: value.productionId ?? value.production_id,
    version: Number(value.version ?? value.scriptVersion ?? value.script_version ?? 8),
    dashboard: normalizeProduction(value.dashboard ?? value.production ?? value),
    changes: (value.changes ?? []).map((item: any) => ({
      id: item.id ?? crypto.randomUUID(),
      scene: String(item.scene ?? item.scene_number ?? item.sceneId ?? item.scene_id ?? '42'),
      type: item.type ?? item.change_type ?? 'ELEMENT_ADDED',
      category: item.category ?? '',
      label: item.label ?? item.newValue ?? item.new_value ?? item.description ?? item.category,
      ignored: false,
    })) as ScriptChange[],
  })),
};
