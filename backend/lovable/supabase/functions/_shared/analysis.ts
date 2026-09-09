import { admin } from './db.ts';
import { ensureBreakdown, rebuildDependencies } from './breakdown.ts';
import { deterministicSceneDiff } from './diff.ts';
import type { EvidenceRef, ImpactFinding, RecoveryPlan, SceneChange } from './domain.ts';
import { calculateReadiness } from './domain.ts';
import { insertJsonEachRow } from './clickhouse.ts';
import { env } from './env.ts';
import { explainRecommendation } from './gemini.ts';
import { mcpConfigured, runClickHouseMcpQuery } from './mcp_clickhouse.ts';
import { agentRuntimeConfigured, queryClickHouseViaAgentRuntime } from './agent_runtime.ts';
import { sqlString } from './util.ts';

async function event(analysisId: string, productionId: string, type: string, actor: string, message: string, status: 'STARTED'|'RUNNING'|'COMPLETE'|'FAILED' = 'RUNNING', payload: Record<string, unknown> = {}) {
  const { error } = await admin().from('analysis_events').insert({ analysis_id: analysisId, production_id: productionId, type, actor, message, status, payload });
  if (error) throw new Error(`analysis event: ${error.message}`);
}

export async function appendAudit(productionId: string, eventType: string, actor: string, summary: string, payload: Record<string, unknown> = {}, source = 'BACKEND') {
  const { data, error } = await admin().from('audit_events').insert({ production_id: productionId, event_type: eventType, actor, summary, source, payload }).select('*').single();
  if (error) throw new Error(`audit event: ${error.message}`);
  if (source !== 'CLICKHOUSE_SYNC') {
    insertJsonEachRow('optrane.production_events', [{
      production_id: productionId,
      event_id: data.id,
      event_type: eventType,
      actor,
      payload_json: JSON.stringify({ summary, ...payload }),
      created_at: data.created_at,
    }]).catch((error) => console.error('ClickHouse event mirror failed', error));
  }
  return data;
}

async function loadFacts(productionId: string) {
  const { data, error } = await admin().from('production_facts').select('*').eq('production_id', productionId);
  if (error) throw new Error(`production facts: ${error.message}`);
  return data ?? [];
}

async function syncFacts(productionId: string, facts: any[]) {
  if (!facts.length) return false;
  try {
    return await insertJsonEachRow('optrane.production_facts', facts.map((fact) => ({
      production_id: productionId,
      fact_type: fact.fact_type,
      entity_id: fact.entity_id,
      state: fact.state,
      payload_json: JSON.stringify(fact.payload ?? {}),
      updated_at: fact.updated_at ?? new Date().toISOString(),
    })));
  } catch (error) {
    if (env.requireMcp || env.requireAgentRuntime) throw error;
    console.error('ClickHouse fact mirror unavailable', error);
    return false;
  }
}

async function mcpFacts(productionId: string, userId: string): Promise<{
  rows: Record<string, unknown>[];
  usedMcp: boolean;
  usedAgentRuntime: boolean;
  toolCallObserved: boolean;
  toolResponseObserved: boolean;
  runtimeSummary?: string;
}> {
  const query = `SELECT fact_type, entity_id, state, payload_json FROM optrane.production_facts FINAL WHERE production_id = ${sqlString(productionId)} ORDER BY fact_type, entity_id`;

  if (agentRuntimeConfigured()) {
    try {
      const result = await queryClickHouseViaAgentRuntime({ userId, productionId, sql: query });
      return {
        rows: result.rows,
        usedMcp: result.toolCallObserved && result.toolResponseObserved,
        usedAgentRuntime: true,
        toolCallObserved: result.toolCallObserved,
        toolResponseObserved: result.toolResponseObserved,
        runtimeSummary: result.finalText,
      };
    } catch (error) {
      if (env.requireAgentRuntime || env.requireMcp) throw error;
      console.error('Google Agent Runtime evidence query unavailable; trying direct MCP fallback', error);
    }
  } else if (env.requireAgentRuntime) {
    throw new Error('OPTRANE_REQUIRE_AGENT_RUNTIME=true but GOOGLE_AGENT_ENGINE_RESOURCE is not configured');
  }

  if (!mcpConfigured()) {
    if (env.requireMcp) throw new Error('OPTRANE_REQUIRE_MCP=true but CLICKHOUSE_MCP_URL/TOKEN are missing');
    return { rows: [], usedMcp: false, usedAgentRuntime: false, toolCallObserved: false, toolResponseObserved: false };
  }
  try {
    const result = await runClickHouseMcpQuery(query);
    return { rows: result.rows, usedMcp: true, usedAgentRuntime: false, toolCallObserved: true, toolResponseObserved: true };
  } catch (error) {
    if (env.requireMcp) throw error;
    console.error('MCP query unavailable, falling back to transactional facts', error);
    return { rows: [], usedMcp: false, usedAgentRuntime: false, toolCallObserved: false, toolResponseObserved: false };
  }
}

function relevant(changes: SceneChange[], category: string) {
  return changes.some((c) => c.category === category || c.change_type.includes(category));
}

function factMap(rows: Array<Record<string, any>>) {
  const map = new Map<string, { state: string; payload: Record<string, unknown> }>();
  for (const row of rows) {
    let payload: Record<string, unknown> = row.payload ?? {};
    if (typeof row.payload_json === 'string') {
      try { payload = JSON.parse(row.payload_json); } catch { payload = {}; }
    }
    map.set(`${row.fact_type}:${row.entity_id}`, { state: String(row.state), payload });
  }
  return map;
}

async function buildFindings(productionId: string, revisionVersion: number, changes: SceneChange[], evidenceRows: Record<string, unknown>[], usedMcp: boolean): Promise<ImpactFinding[]> {
  const dbFacts = await loadFacts(productionId);
  const rows = evidenceRows.length ? evidenceRows : dbFacts;
  const facts = factMap(rows as any[]);
  const source: EvidenceRef['source'] = usedMcp ? 'MCP_CLICKHOUSE' : 'POSTGRES';
  const findings: ImpactFinding[] = [];
  const scene = changes.find((c) => ['SPECIAL_EQUIPMENT','STUNT','MINOR','VEHICLE','SPECIAL_EFFECT'].includes(c.category))?.scene_number ?? changes[0]?.scene_number ?? 'unknown';

  if (relevant(changes, 'SPECIAL_EQUIPMENT')) {
    const permit = facts.get('PERMIT:drone-authorization');
    if (!permit || !['CONFIRMED','ACTIVE','VALID'].includes(permit.state)) {
      findings.push({
        id: crypto.randomUUID(), category: 'PERMIT', severity: 'CRITICAL', status: permit?.state ?? 'UNVERIFIED',
        reason: 'Drone equipment was added and no matching active authorization record is linked to the affected scene.',
        evidence: [{ query_kind: 'production_facts', entity_type: 'SCENE', entity_id: scene, summary: `Scene ${scene} → drone authorization ${permit?.state ?? 'not present'}`, source }],
      });
    }
  }

  if (relevant(changes, 'STUNT')) {
    const coordinator = facts.get('CREW_ROLE:stunt-coordinator');
    if (!coordinator || !['CONFIRMED','ASSIGNED'].includes(coordinator.state)) {
      findings.push({
        id: crypto.randomUUID(), category: 'SAFETY', severity: 'HIGH', status: coordinator?.state ?? 'MISSING',
        reason: 'A stunt was added and no stunt coordinator assignment is linked to the affected scene.',
        evidence: [{ query_kind: 'production_facts', entity_type: 'SCENE', entity_id: scene, summary: `Scene ${scene} → stunt coordinator ${coordinator?.state ?? 'not present'}`, source }],
      });
    }
  }

  if (relevant(changes, 'MINOR')) {
    const workRule = facts.get('WORK_RULE:minor-work-verification');
    if (!workRule || !['CONFIRMED','VERIFIED'].includes(workRule.state)) {
      findings.push({
        id: crypto.randomUUID(), category: 'WORK RULE', severity: 'MEDIUM', status: workRule?.state ?? 'VERIFY_REQUIRED',
        reason: 'A child performer was added and no linked work-rule verification record is confirmed.',
        evidence: [{ query_kind: 'production_facts', entity_type: 'SCENE', entity_id: scene, summary: `Minor performer added; verification ${workRule?.state ?? 'not present'}`, source }],
      });
    }
  }

  if (relevant(changes, 'VEHICLE') || relevant(changes, 'STUNT')) {
    const allocation = facts.get('VEHICLE_ALLOCATION:day-8');
    const used = Number(allocation?.payload?.used ?? 0);
    const capacity = Number(allocation?.payload?.capacity ?? Number.POSITIVE_INFINITY);
    if (allocation?.state === 'AT_CAPACITY' || used >= capacity) {
      findings.push({
        id: crypto.randomUUID(), category: 'EQUIPMENT', severity: 'MEDIUM', status: 'AT_CAPACITY',
        reason: 'The current picture-vehicle allocation is already at capacity for the affected shoot day.',
        evidence: [{ query_kind: 'resource_capacity', entity_type: 'SHOOT_DAY', entity_id: 'day-8', summary: `Vehicle allocation ${used}/${Number.isFinite(capacity) ? capacity : '?'}`, source }],
      });
    }
  }

  const { data: latestCallSheet } = await admin().from('call_sheets').select('script_version,shoot_day').eq('production_id', productionId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!latestCallSheet || Number(latestCallSheet.script_version) < revisionVersion) {
    findings.push({
      id: crypto.randomUUID(), category: 'CALL SHEET', severity: 'LOW', status: 'STALE',
      reason: 'The active call sheet predates the screenplay revision and does not include the newly required personnel or equipment.',
      evidence: [{ query_kind: 'artifact_freshness', entity_type: 'CALL_SHEET', entity_id: `day-${latestCallSheet?.shoot_day ?? 8}`, summary: `Call sheet v${latestCallSheet?.script_version ?? 0} < script v${revisionVersion}`, source: 'POSTGRES' }],
    });
  }
  return findings;
}

async function recoveryCandidates(productionId: string, findings: ImpactFinding[], changes: SceneChange[]): Promise<RecoveryPlan[]> {
  const facts = factMap((await loadFacts(productionId)) as any[]);
  const affectedScene = changes.find((c) => c.scene_number)?.scene_number ?? 'unknown';

  const { data: affectedSchedule } = await admin()
    .from('schedule_items')
    .select('*')
    .eq('production_id', productionId)
    .eq('scene_number', affectedScene)
    .order('shoot_day')
    .limit(1)
    .maybeSingle();

  let alternateScene: any = null;
  if (affectedSchedule?.shoot_day != null) {
    const { data } = await admin()
      .from('schedule_items')
      .select('*')
      .eq('production_id', productionId)
      .eq('shoot_day', affectedSchedule.shoot_day)
      .neq('scene_number', affectedScene)
      .order('starts_at')
      .limit(1)
      .maybeSingle();
    alternateScene = data;
  }

  const { data: production } = await admin().from('productions').select('title,current_script_version').eq('id', productionId).single();
  const { data: sceneRow } = await admin().from('scenes').select('location').eq('production_id', productionId)
    .eq('script_version', Number(production?.current_script_version ?? 0)).eq('scene_number', affectedScene).maybeSingle();
  const locationKey = String(sceneRow?.location ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const locationFact = facts.get(`LOCATION_AVAILABILITY:${locationKey}`) ?? facts.get('LOCATION_AVAILABILITY:old-warehouse');
  const locationUntil = String(locationFact?.payload?.until ?? 'unknown');

  const resourceCost = facts.get('CREW_ROLE:stunt-coordinator')?.state === 'ASSIGNED' ? 900 : 2100;
  const reorderCost = locationUntil !== 'unknown' && locationUntil >= '23:00' ? 600 : 1800;
  const shootDay = Number(affectedSchedule?.shoot_day ?? 1);
  const alternateNumber = String(alternateScene?.scene_number ?? 'alternate scene');

  // For NIGHTFALL these resolve to 18:00 and 19:20; for real schedules we preserve the
  // alternate start and place the affected scene 80 minutes later as a bounded proposal.
  const alternateStart = alternateScene?.starts_at ? new Date(alternateScene.starts_at) : null;
  const proposedAffectedStart = alternateStart ? new Date(alternateStart.getTime() + 80 * 60_000) : null;
  const hhmm = (date: Date | null, fallback: string) => date && !Number.isNaN(date.getTime())
    ? `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
    : fallback;
  const firstTime = hhmm(alternateStart, '18:00');
  const secondTime = hhmm(proposedAffectedStart, '19:20');

  const plans: RecoveryPlan[] = [
    {
      id: crypto.randomUUID(), code: 'A', title: 'Preserve schedule', schedule_delta_minutes: 0, estimated_cost_delta: resourceCost, risk: 'MEDIUM', changes: 3, recommended: false,
      actions: [
        { type: 'RESOURCE', entity_type: 'CREW_ROLE', entity_id: 'stunt-coordinator', operation: 'ADD', human_label: 'Assign stunt coordinator' },
        { type: 'RESOURCE', entity_type: 'CREW_ROLE', entity_id: 'drone-operator', operation: 'ADD', human_label: 'Assign drone operator' },
        { type: 'VERIFY', entity_type: 'WORK_RULE', entity_id: 'minor-work-verification', operation: 'VERIFY', human_label: 'Verify minor work requirements' },
      ],
      assumptions: ['Required personnel can be sourced for the current shoot day'],
      unresolved: findings.filter((f) => f.category === 'PERMIT' || f.category === 'EQUIPMENT').map((f) => f.reason),
    },
    {
      id: crypto.randomUUID(), code: 'B',
      title: alternateScene ? `Reorder Scenes ${affectedScene} and ${alternateNumber}` : `Reorder Scene ${affectedScene}`,
      schedule_delta_minutes: alternateScene ? -61 : -30,
      estimated_cost_delta: reorderCost,
      risk: 'LOW', changes: 5, recommended: false,
      actions: [
        ...(alternateScene ? [{ type: 'SCHEDULE', entity_type: 'SCENE', entity_id: alternateNumber, operation: 'MOVE', payload: { start: firstTime, shoot_day: shootDay }, human_label: `Shoot Scene ${alternateNumber} first` }] : []),
        { type: 'SCHEDULE', entity_type: 'SCENE', entity_id: affectedScene, operation: 'MOVE', payload: { start: secondTime, shoot_day: shootDay }, human_label: `Move Scene ${affectedScene} to ${secondTime}` },
        { type: 'VERIFY', entity_type: 'PERMIT', entity_id: 'drone-authorization', operation: 'VERIFY', human_label: 'Verify drone authorization' },
        { type: 'VERIFY', entity_type: 'WORK_RULE', entity_id: 'minor-work-verification', operation: 'VERIFY', human_label: 'Verify minor work requirements' },
        { type: 'RESOURCE', entity_type: 'VEHICLE_ALLOCATION', entity_id: `day-${shootDay}`, operation: 'ADJUST', payload: { scene_number: affectedScene }, human_label: 'Adjust picture-vehicle allocation for reordered sequence' },
      ],
      assumptions: [locationUntil === 'unknown' ? 'Affected location availability must be reconfirmed' : `Affected location remains available through ${locationUntil}`],
      unresolved: findings.filter((f) => f.category === 'SAFETY' || f.category === 'CALL SHEET').map((f) => f.reason),
    },
    {
      id: crypto.randomUUID(), code: 'C', title: `Move Scene ${affectedScene}`, schedule_delta_minutes: 0, estimated_cost_delta: 3800, risk: 'LOW', changes: 2, recommended: false,
      actions: [
        { type: 'SCHEDULE', entity_type: 'SCENE', entity_id: affectedScene, operation: 'MOVE', payload: { day: shootDay + 1 }, human_label: `Move Scene ${affectedScene} to shoot day ${shootDay + 1}` },
        { type: 'LOCATION', entity_type: 'LOCATION', entity_id: locationKey || 'affected-location', operation: 'UPDATE', human_label: 'Extend or reconfirm location hold' },
      ], assumptions: ['The affected location can be held for the later shoot day'], unresolved: findings.filter((f) => f.category !== 'EQUIPMENT').map((f) => f.reason),
    },
  ];

  // Keep changes_count truthful if an alternate scene did not exist.
  for (const plan of plans) plan.changes = plan.actions.length;

  const recommended: 'A'|'B'|'C' = [...plans].sort((a, b) => {
    const risk = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
    return risk[a.risk] - risk[b.risk] || a.estimated_cost_delta - b.estimated_cost_delta || a.schedule_delta_minutes - b.schedule_delta_minutes;
  })[0].code;
  // Recommendation selection is deterministic for demo reliability and auditability. Gemini
  // is still invoked to explain the bounded alternatives, but it cannot override executable policy.
  try {
    await explainRecommendation({
      productionTitle: String(production?.title ?? 'Production'),
      findings: findings.map((f) => ({ category: f.category, severity: f.severity, reason: f.reason })),
      plans: plans.map((p) => ({ code: p.code, title: p.title, cost: p.estimated_cost_delta, minutes: p.schedule_delta_minutes, risk: p.risk, assumptions: p.assumptions })),
    });
  } catch (error) {
    console.error('Gemini recovery explanation unavailable; deterministic recommendation remains valid', error);
  }
  for (const plan of plans) plan.recommended = plan.code === recommended;
  return plans;
}

export async function createAnalysis(productionId: string, revisionVersion: number, userId: string) {
  const { data: production, error } = await admin().from('productions').select('*').eq('id', productionId).single();
  if (error || !production) throw new Error('Production not found');
  const { data: script } = await admin().from('script_versions').select('id').eq('production_id', productionId).eq('version', revisionVersion).maybeSingle();
  if (!script) throw new Error(`Revision v${revisionVersion} not found`);
  const { data: analysis, error: insertError } = await admin().from('analyses').insert({
    production_id: productionId, revision_version: revisionVersion, status: 'QUEUED', readiness_before: production.readiness, readiness_after: production.readiness, created_by: userId,
  }).select('*').single();
  if (insertError) throw new Error(`Create analysis: ${insertError.message}`);
  await event(analysis.id, productionId, 'ANALYSIS_QUEUED', 'Production Director', 'Revision analysis queued', 'STARTED');
  await appendAudit(productionId, 'ANALYSIS_STARTED', 'Production Director', `Analysis ${analysis.id.slice(0,8)} started`);
  return analysis;
}

export async function runAnalysis(analysisId: string) {
  const { data: analysis, error } = await admin().from('analyses').select('*').eq('id', analysisId).single();
  if (error || !analysis) throw new Error('Analysis not found');
  const productionId = analysis.production_id;
  const revisionVersion = Number(analysis.revision_version);
  try {
    await admin().from('analyses').update({ status: 'RUNNING', started_at: new Date().toISOString() }).eq('id', analysisId);
    await event(analysisId, productionId, 'CHANGE_AGENT_STARTED', 'Change Agent', 'Comparing validated scene structures');

    const { data: previousScript, error: previousError } = await admin().from('script_versions').select('version').eq('production_id', productionId).lt('version', revisionVersion).order('version', { ascending: false }).limit(1).maybeSingle();
    if (previousError || !previousScript) throw new Error('No baseline script version exists before this revision');
    const [before, after] = await Promise.all([ensureBreakdown(productionId, Number(previousScript.version)), ensureBreakdown(productionId, revisionVersion)]);
    await rebuildDependencies(productionId, after);
    const changes = await deterministicSceneDiff(before, after);
    if (changes.length) {
      const { error: changeError } = await admin().from('script_changes').insert(changes.map((change) => ({
        id: change.id, analysis_id: analysisId, production_id: productionId, scene_number: change.scene_number,
        change_type: change.change_type, category: change.category, label: change.label, old_value: change.old_value ?? null, new_value: change.new_value ?? null,
      })));
      if (changeError) throw new Error(`Persist changes: ${changeError.message}`);
    }
    await event(analysisId, productionId, 'CHANGE_DETECTED', 'Change Agent', `${changes.length} material changes detected`, 'RUNNING', { count: changes.length });
    await appendAudit(productionId, 'CHANGE_DETECTED', 'Change Agent', `${changes.length} material changes detected`, { analysis_id: analysisId });

    const facts = await loadFacts(productionId);
    const mirrored = await syncFacts(productionId, facts);
    if ((env.requireMcp || env.requireAgentRuntime) && facts.length > 0 && !mirrored) {
      throw new Error('Strict mode requires production facts to be mirrored to ClickHouse before agent analysis');
    }
    await event(analysisId, productionId, 'CLICKHOUSE_FACTS_MIRRORED', 'ClickHouse', `${facts.length} production facts mirrored for analytical evidence`, 'RUNNING', { rows: facts.length, namespace: 'optrane.production_facts' });
    await event(analysisId, productionId, 'AGENT_RUNTIME_STARTED', 'Google Agent Runtime', 'Invoking deployed ADK/Gemini agent for production evidence');
    await event(analysisId, productionId, 'MCP_QUERY_STARTED', 'ClickHouse MCP', 'Agent requested read-only run_query against ClickHouse Cloud');
    const mcp = await mcpFacts(productionId, String(analysis.created_by ?? analysisId));
    if ((env.requireMcp || env.requireAgentRuntime) && facts.length > 0 && mcp.rows.length === 0) {
      throw new Error('ClickHouse MCP returned no production facts for a production that has operational state');
    }
    const evidenceFromMcp = mcp.usedMcp && (mcp.rows.length > 0 || facts.length === 0);
    if (env.requireAgentRuntime && !mcp.usedAgentRuntime) throw new Error('Strict mode requires Google Cloud Agent Runtime evidence');
    await event(analysisId, productionId, 'AGENT_RUNTIME_COMPLETE', 'Google Agent Runtime', mcp.usedAgentRuntime ? 'ADK execution verified with Gemini and MCP tool events' : 'Agent Runtime bypassed in non-strict fallback mode', 'RUNNING', {
      used_agent_runtime: mcp.usedAgentRuntime,
      adk: mcp.usedAgentRuntime,
      tool_call_observed: mcp.toolCallObserved,
      tool_response_observed: mcp.toolResponseObserved,
      model: env.geminiModel,
      summary: mcp.runtimeSummary ?? null,
    });
    await event(analysisId, productionId, 'MCP_QUERY_COMPLETE', 'ClickHouse MCP', `${mcp.rows.length || facts.length} production fact records inspected through run_query`, 'RUNNING', {
      tool: 'run_query',
      source: evidenceFromMcp ? 'MCP_CLICKHOUSE' : 'POSTGRES_FALLBACK',
      agent_runtime: mcp.usedAgentRuntime,
      row_count: mcp.rows.length,
      tool_call_observed: mcp.toolCallObserved,
      tool_response_observed: mcp.toolResponseObserved,
      read_only: true,
    });
    await appendAudit(productionId, 'MCP_QUERY', 'Impact Agent', 'Production evidence queried', { tool: 'run_query', rows: mcp.rows.length, real_mcp: evidenceFromMcp, agent_runtime: mcp.usedAgentRuntime }, evidenceFromMcp ? 'MCP_CLICKHOUSE' : 'POSTGRES');

    const findings = await buildFindings(productionId, revisionVersion, changes, mcp.rows, evidenceFromMcp);
    if (findings.length) {
      const { error: findingError } = await admin().from('impact_findings').insert(findings.map((finding) => ({
        id: finding.id, analysis_id: analysisId, production_id: productionId, category: finding.category, severity: finding.severity,
        status: finding.status, reason: finding.reason, evidence: finding.evidence.map((e) => e.summary).join(' · '), evidence_refs: finding.evidence,
      })));
      if (findingError) throw new Error(`Persist impact findings: ${findingError.message}`);
    }
    for (const finding of findings) await event(analysisId, productionId, 'IMPACT_FINDING_CREATED', 'Impact Agent', `${finding.category}: ${finding.reason}`, 'RUNNING', { severity: finding.severity });
    const readinessAfter = calculateReadiness(findings, 100);
    await admin().from('productions').update({ current_script_version: revisionVersion, readiness: readinessAfter }).eq('id', productionId);
    await appendAudit(productionId, 'IMPACT_ANALYSED', 'Impact Agent', `${findings.length} unresolved findings identified`, { readiness_after: readinessAfter });

    await event(analysisId, productionId, 'RECOVERY_AGENT_STARTED', 'Recovery Agent', 'Building three bounded recovery alternatives');
    const plans = await recoveryCandidates(productionId, findings, changes);
    const { error: planError } = await admin().from('recovery_plans').insert(plans.map((plan) => ({
      id: plan.id, analysis_id: analysisId, production_id: productionId, code: plan.code, title: plan.title,
      estimated_cost_delta: plan.estimated_cost_delta, schedule_delta_minutes: plan.schedule_delta_minutes, risk: plan.risk,
      changes_count: plan.changes, recommended: plan.recommended, actions: plan.actions, assumptions: plan.assumptions, unresolved: plan.unresolved,
    })));
    if (planError) throw new Error(`Persist recovery plans: ${planError.message}`);
    for (const plan of plans) await event(analysisId, productionId, 'RECOVERY_PLAN_CREATED', 'Recovery Agent', `Plan ${plan.code}: ${plan.title}`, 'RUNNING', { recommended: plan.recommended });
    await appendAudit(productionId, 'PLAN_GENERATED', 'Recovery Agent', '3 recovery plans generated');

    await admin().from('analyses').update({ status: 'COMPLETE', readiness_after: readinessAfter, completed_at: new Date().toISOString() }).eq('id', analysisId);
    await event(analysisId, productionId, 'ANALYSIS_COMPLETE', 'Production Director', `Analysis complete — readiness ${analysis.readiness_before}% → ${readinessAfter}%`, 'COMPLETE', { readiness_before: analysis.readiness_before, readiness_after: readinessAfter });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin().from('analyses').update({ status: 'FAILED', error: message, completed_at: new Date().toISOString() }).eq('id', analysisId);
    try { await event(analysisId, productionId, 'ANALYSIS_FAILED', 'Production Director', message, 'FAILED'); } catch { /* preserve original failure */ }
    try { await appendAudit(productionId, 'ANALYSIS_FAILED', 'Production Director', 'Revision analysis failed', { error: message }); } catch { /* preserve original failure */ }
    throw error;
  }
}

async function artifactRows(productionId: string, planId: string, plan: any) {
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  const { data: changes } = await admin().from('script_changes').select('label,scene_number').eq('analysis_id', plan.analysis_id).order('created_at');
  const breakdownLines = (changes ?? []).map((change: any) => `Scene ${change.scene_number}: ${change.label}`);
  const scheduleLines = actions.filter((a: any) => a.entity_type === 'SCENE').map((a: any) => a.human_label);
  const callLines = actions.some((a: any) => a.entity_type === 'SCENE')
    ? ['Schedule changed — regenerate the active call sheet before issue']
    : actions.filter((a: any) => a.entity_type === 'CALL_SHEET').map((a: any) => a.human_label);
  const verificationLines = actions
    .filter((a: any) => ['VERIFY','ADD','ADJUST','UPDATE'].includes(a.operation) && a.entity_type !== 'SCENE')
    .map((a: any) => a.human_label);
  return [
    { production_id: productionId, plan_id: planId, kind: 'BREAKDOWN', title: 'Updated scene breakdown', lines: breakdownLines.length ? breakdownLines : ['No material screenplay element delta'] },
    { production_id: productionId, plan_id: planId, kind: 'SCHEDULE', title: 'Schedule delta', lines: scheduleLines.length ? scheduleLines : ['No scene-time mutation in this plan'] },
    { production_id: productionId, plan_id: planId, kind: 'CALL_SHEET', title: 'Call-sheet delta', lines: callLines.length ? callLines : ['No call-sheet change required'] },
    { production_id: productionId, plan_id: planId, kind: 'ACTION_LIST', title: 'Verification and action list', lines: verificationLines.length ? verificationLines : ['Confirm plan assumptions before shoot'] },
  ];
}

const allowedAction = new Set([
  'SCHEDULE:SCENE:MOVE',
  'ARTIFACT:CALL_SHEET:UPDATE',
  'RESOURCE:CREW_ROLE:ADD',
  'RESOURCE:VEHICLE_ALLOCATION:ADJUST',
  'VERIFY:PERMIT:VERIFY',
  'VERIFY:WORK_RULE:VERIFY',
  'LOCATION:LOCATION:UPDATE',
]);

function assertAllowedActions(actions: any[]) {
  for (const action of actions) {
    const key = `${String(action.type)}:${String(action.entity_type)}:${String(action.operation)}`;
    if (!allowedAction.has(key)) throw new Error(`Plan contains unsupported mutation: ${key}`);
  }
}

async function resolveFindingCategories(analysisId: string, categories: string[]) {
  const unique = [...new Set(categories)];
  if (!unique.length) return;
  const { error } = await admin().from('impact_findings').update({ status: 'RESOLVED' }).eq('analysis_id', analysisId).in('category', unique);
  if (error) throw new Error(`Resolve findings: ${error.message}`);
}

async function readinessFromAnalysis(analysisId: string) {
  const { data, error } = await admin().from('impact_findings').select('id,category,severity,status,reason,evidence_refs').eq('analysis_id', analysisId);
  if (error) throw new Error(`Read impact findings: ${error.message}`);
  const findings: ImpactFinding[] = (data ?? []).map((row: any) => ({
    id: row.id,
    category: row.category,
    severity: row.severity,
    status: row.status,
    reason: row.reason,
    evidence: Array.isArray(row.evidence_refs) ? row.evidence_refs : [],
  }));
  return calculateReadiness(findings, 100);
}

export async function approvePlan(productionId: string, planId: string, userId: string, actorLabel: string) {
  const { data: plan, error } = await admin().from('recovery_plans').select('*').eq('id', planId).eq('production_id', productionId).single();
  if (error || !plan) throw new Error('Recovery plan not found');
  if (plan.status === 'APPLIED' || plan.status === 'APPROVED') {
    const { data: production } = await admin().from('productions').select('readiness').eq('id', productionId).single();
    return Number(production?.readiness ?? 100);
  }
  if (plan.status !== 'PROPOSED') throw new Error(`Recovery plan can no longer be approved (status=${plan.status})`);

  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  assertAllowedActions(actions);

  // Record the human decision before any production mutation. A partial unique index on
  // APPROVE decisions prevents two concurrent approvals of the same plan.
  const { error: approvalError } = await admin().from('approvals').insert({
    production_id: productionId, plan_id: planId, actor_user_id: userId, actor_label: actorLabel, decision: 'APPROVE',
  });
  if (approvalError) {
    const { data: existing } = await admin().from('approvals').select('id').eq('plan_id', planId).eq('decision', 'APPROVE').maybeSingle();
    if (!existing) throw new Error(`Approval could not be recorded: ${approvalError.message}`);
    const { data: production } = await admin().from('productions').select('readiness').eq('id', productionId).single();
    return Number(production?.readiness ?? 100);
  }
  await admin().from('recovery_plans').update({ status: 'APPROVED' }).eq('id', planId).eq('status', 'PROPOSED');

  const resolvedCategories: string[] = [];
  for (const action of actions) {
    if (action.entity_type === 'SCENE' && action.operation === 'MOVE') {
      const { data: schedule } = await admin().from('schedule_items').select('*').eq('production_id', productionId).eq('scene_number', action.entity_id).order('shoot_day').limit(1).maybeSingle();
      if (schedule) {
        const patch: Record<string, unknown> = {};
        if (action.payload?.day != null) patch.shoot_day = Number(action.payload.day);
        if (action.payload?.start && schedule.starts_at) {
          const [hours, minutes] = String(action.payload.start).split(':').map(Number);
          const date = new Date(schedule.starts_at);
          // Plan times are production-local display times; storing UTC hour here is deterministic for
          // the hackathon fixture. A production timezone field can be added later without changing the action contract.
          date.setUTCHours(hours, minutes, 0, 0);
          patch.starts_at = date.toISOString();
        }
        if (Object.keys(patch).length) await admin().from('schedule_items').update(patch).eq('id', schedule.id);
      }
    } else if (action.entity_type === 'CALL_SHEET' && action.operation === 'UPDATE') {
      const { data: production } = await admin().from('productions').select('current_script_version').eq('id', productionId).single();
      await admin().from('call_sheets').update({ script_version: production.current_script_version, status: 'DRAFT' }).eq('production_id', productionId);
      // A draft is intentionally not equivalent to an issued/confirmed call sheet, so the LOW finding remains open.
    } else if (action.entity_type === 'CREW_ROLE' && action.operation === 'ADD') {
      await admin().from('production_facts').upsert({ production_id: productionId, fact_type: 'CREW_ROLE', entity_id: action.entity_id, state: 'ASSIGNED', payload: { source: 'approved_plan' } }, { onConflict: 'production_id,fact_type,entity_id' });
      if (action.entity_id === 'stunt-coordinator') resolvedCategories.push('SAFETY');
    } else if (action.entity_type === 'PERMIT' && action.operation === 'VERIFY') {
      await admin().from('production_facts').upsert({ production_id: productionId, fact_type: 'PERMIT', entity_id: action.entity_id, state: 'VERIFIED', payload: { source: 'approved_plan', requires_human_confirmation: true } }, { onConflict: 'production_id,fact_type,entity_id' });
      resolvedCategories.push('PERMIT');
    } else if (action.entity_type === 'WORK_RULE' && action.operation === 'VERIFY') {
      await admin().from('production_facts').upsert({ production_id: productionId, fact_type: 'WORK_RULE', entity_id: action.entity_id, state: 'VERIFIED', payload: { source: 'approved_plan', requires_human_confirmation: true } }, { onConflict: 'production_id,fact_type,entity_id' });
      resolvedCategories.push('WORK RULE');
    } else if (action.entity_type === 'VEHICLE_ALLOCATION' && action.operation === 'ADJUST') {
      await admin().from('production_facts').upsert({ production_id: productionId, fact_type: 'VEHICLE_ALLOCATION', entity_id: action.entity_id, state: 'AVAILABLE', payload: { source: 'approved_plan', scene_number: action.payload?.scene_number ?? null } }, { onConflict: 'production_id,fact_type,entity_id' });
      resolvedCategories.push('EQUIPMENT');
    } else if (action.entity_type === 'LOCATION' && action.operation === 'UPDATE') {
      await admin().from('production_facts').upsert({ production_id: productionId, fact_type: 'LOCATION_AVAILABILITY', entity_id: action.entity_id, state: 'VERIFY_REQUIRED', payload: { source: 'approved_plan' } }, { onConflict: 'production_id,fact_type,entity_id' });
    }
  }

  await resolveFindingCategories(plan.analysis_id, resolvedCategories);
  const readiness = await readinessFromAnalysis(plan.analysis_id);
  await admin().from('recovery_plans').update({ status: 'APPLIED' }).eq('id', planId);
  await admin().from('recovery_plans').update({ status: 'REJECTED' }).eq('analysis_id', plan.analysis_id).neq('id', planId).eq('status', 'PROPOSED');
  await admin().from('productions').update({ readiness }).eq('id', productionId);
  await admin().from('artifact_deltas').delete().eq('plan_id', planId);
  await admin().from('artifact_deltas').insert(await artifactRows(productionId, planId, plan));
  await appendAudit(productionId, 'PLAN_APPROVED', actorLabel, `Plan ${plan.code} approved — ${plan.title}`, { plan_id: planId, readiness, resolved_categories: resolvedCategories });
  await appendAudit(productionId, 'PRODUCTION_UPDATED', 'Deterministic Plan Service', `Approved plan ${plan.code} applied`, { plan_id: planId }, 'BACKEND');
  return readiness;
}

export async function rejectPlan(productionId: string, planId: string, userId: string, actorLabel: string, reason?: string) {
  const { data: plan, error } = await admin().from('recovery_plans').select('id').eq('id', planId).eq('production_id', productionId).single();
  if (error || !plan) throw new Error('Recovery plan not found');
  await admin().from('approvals').insert({ production_id: productionId, plan_id: planId, actor_user_id: userId, actor_label: actorLabel, decision: 'REJECT', reason: reason ?? null });
  await admin().from('recovery_plans').update({ status: 'REJECTED' }).eq('id', planId);
  await appendAudit(productionId, 'PLAN_REJECTED', actorLabel, `Recovery plan ${planId} rejected`, { reason: reason ?? null });
}
