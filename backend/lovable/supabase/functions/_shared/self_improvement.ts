import { admin } from './db.ts';
import { HttpError } from './http.ts';
import { proposeSelfImprovementViaAgentRuntime } from './agent_runtime.ts';
import { agentcessRequest } from './agentcess.ts';

export const DEFAULT_SELF_IMPROVEMENT_RULE = 'May improve reasoning strategy, prompts, retrieval order, tool ordering, error recovery and confidence thresholds. It may not add tools, expand permissions or data access, change model or executable code, modify governance policy, or increase any budget. Improvements are candidates only and require human approval before promotion.';

export const ALLOWED_IMPROVEMENT_TYPES = [
  'PROMPT_VARIANT', 'PLANNING_STRATEGY', 'RETRIEVAL_STRATEGY', 'TOOL_ORDERING', 'ERROR_RECOVERY_RULE', 'CONFIDENCE_THRESHOLD',
] as const;

export const FORBIDDEN_IMPROVEMENTS = [
  'NEW_TOOL', 'PERMISSION_ESCALATION', 'NEW_DATA_CLASS', 'BUDGET_INCREASE', 'MODEL_CHANGE', 'SECRET_ACCESS', 'POLICY_CHANGE', 'EXECUTABLE_CODE_CHANGE',
] as const;

export function normalizedSelfImprovement(input: any = {}) {
  const budget = input.budget ?? {};
  return {
    enabled: input.enabled !== false,
    rule: input.rule ?? DEFAULT_SELF_IMPROVEMENT_RULE,
    allowed: Array.isArray(input.allowed) && input.allowed.length ? input.allowed.filter((x: string) => ALLOWED_IMPROVEMENT_TYPES.includes(x as any)) : [...ALLOWED_IMPROVEMENT_TYPES],
    forbidden: [...FORBIDDEN_IMPROVEMENTS],
    requiresHumanApproval: true,
    budget: {
      currency: 'USD',
      perIteration: Math.max(0, Math.min(5, Number(budget.perIteration ?? budget.per_iteration ?? 0.25))),
      daily: Math.max(0, Math.min(50, Number(budget.daily ?? 2))),
      maxIterationsPerRun: Math.max(0, Math.min(10, Number(budget.maxIterationsPerRun ?? budget.max_iterations_per_run ?? 2))),
      maxDailyIterations: Math.max(0, Math.min(100, Number(budget.maxDailyIterations ?? budget.max_daily_iterations ?? 10))),
    },
  };
}

async function todayUsage(agentId: string) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { data, error } = await admin().from('agent_budget_ledger').select('amount, units').eq('agent_id', agentId).eq('category', 'SELF_IMPROVEMENT').gte('created_at', start.toISOString());
  if (error) throw new Error(`self-improvement budget ledger: ${error.message}`);
  return (data ?? []).reduce((acc, row) => ({ amount: acc.amount + Number(row.amount ?? 0), units: acc.units + Number(row.units ?? 0) }), { amount: 0, units: 0 });
}

async function runUsage(agentId: string, runId?: string) {
  if (!runId) return { amount: 0, units: 0 };
  const { data, error } = await admin().from('agent_budget_ledger').select('amount, units').eq('agent_id', agentId).eq('run_id', runId).eq('category', 'SELF_IMPROVEMENT');
  if (error) throw new Error(`self-improvement run ledger: ${error.message}`);
  return (data ?? []).reduce((acc, row) => ({ amount: acc.amount + Number(row.amount ?? 0), units: acc.units + Number(row.units ?? 0) }), { amount: 0, units: 0 });
}

export async function improvementBudgetState(agent: any, runId?: string) {
  const policy = normalizedSelfImprovement({ ...(agent.self_improvement_policy ?? {}), budget: agent.self_improvement_budget ?? agent.self_improvement_policy?.budget ?? {} });
  const [daily, run] = await Promise.all([todayUsage(agent.id), runUsage(agent.id, runId)]);
  return {
    policy,
    dailySpent: daily.amount,
    dailyIterations: daily.units,
    runSpent: run.amount,
    runIterations: run.units,
    remainingDaily: Math.max(0, policy.budget.daily - daily.amount),
    remainingDailyIterations: Math.max(0, policy.budget.maxDailyIterations - daily.units),
    remainingRunIterations: Math.max(0, policy.budget.maxIterationsPerRun - run.units),
  };
}

function validateProposal(policy: ReturnType<typeof normalizedSelfImprovement>, proposal: any, remainingDaily: number, remainingRunIterations: number) {
  if (!policy.enabled) throw new HttpError(409, 'Self-improvement is disabled for this agent', 'self_improvement_disabled');
  if (!policy.allowed.includes(proposal.type)) throw new HttpError(422, 'Proposed self-improvement type is not allowed', 'self_improvement_type_denied');
  if (!proposal.proposed_value?.trim()) throw new HttpError(422, 'Self-improvement proposal is empty', 'self_improvement_empty');
  const estimated = Number(proposal.estimated_cost ?? 0);
  if (!Number.isFinite(estimated) || estimated < 0) throw new HttpError(422, 'Invalid self-improvement cost', 'self_improvement_cost_invalid');
  if (estimated > policy.budget.perIteration + 1e-9) throw new HttpError(403, 'Self-improvement proposal exceeds the per-iteration budget cap', 'self_improvement_iteration_budget_exceeded');
  if (estimated > remainingDaily + 1e-9) throw new HttpError(403, 'Self-improvement daily budget is exhausted', 'self_improvement_daily_budget_exceeded');
  if (remainingRunIterations <= 0) throw new HttpError(403, 'Self-improvement iteration cap reached for this run', 'self_improvement_iteration_cap');
  const lowered = String(proposal.proposed_value).toLowerCase();
  const redFlags = ['new tool', 'add tool', 'permission', 'secret', 'change model', 'increase budget', 'modify code', 'execute code', 'policy change'];
  if (redFlags.some((flag) => lowered.includes(flag))) throw new HttpError(422, 'Self-improvement candidate appears to request a forbidden boundary change', 'self_improvement_boundary_violation');
}

export async function proposeImprovement(input: { userId: string; productionId: string; agent: any; runId?: string; evidence?: Record<string, unknown> }) {
  const state = await improvementBudgetState(input.agent, input.runId);
  if (!state.policy.enabled) throw new HttpError(409, 'Self-improvement is disabled for this agent', 'self_improvement_disabled');
  if (state.remainingDaily <= 0 || state.remainingDailyIterations <= 0 || state.remainingRunIterations <= 0) throw new HttpError(403, 'Self-improvement budget or iteration cap is exhausted', 'self_improvement_budget_exhausted');
  const perIterationCap = Math.min(state.policy.budget.perIteration, state.remainingDaily);
  const proposal = await proposeSelfImprovementViaAgentRuntime({
    userId: input.userId,
    agentId: input.agent.id,
    currentStrategy: input.agent.strategy_config ?? {},
    evidence: input.evidence ?? {},
    allowedTypes: state.policy.allowed,
    forbidden: state.policy.forbidden,
    remainingBudget: state.remainingDaily,
    remainingIterations: Math.min(state.remainingDailyIterations, state.remainingRunIterations),
    perIterationCap,
  });
  validateProposal(state.policy, proposal, state.remainingDaily, state.remainingRunIterations);
  const estimated = Number(proposal.estimated_cost ?? 0);

  // Provider-native governance stays private to OPTRANE. The Tauri app never sees
  // this route, provider token, peer signature, policy payload, or native evidence.
  // Local deterministic caps are checked before Gemini runs; the governance
  // provider independently authorizes the concrete candidate before persistence.
  if (input.agent.agentcess_agent_id) {
    let providerRunId: string | null = null;
    if (input.runId) {
      const { data: run } = await admin().from('agent_runs').select('agentcess_run_id').eq('id', input.runId).eq('agent_id', input.agent.id).maybeSingle();
      providerRunId = run?.agentcess_run_id ?? null;
    }
    const decision = await agentcessRequest<any>('/v1/authorizations/check', {
      method: 'POST',
      body: JSON.stringify({
        agentId: input.agent.agentcess_agent_id,
        runId: providerRunId,
        action: 'SELF_IMPROVEMENT',
        improvement: {
          type: proposal.type,
          description: proposal.proposed_value,
          estimatedCostUsd: estimated,
        },
      }),
    });
    if (String(decision.decision ?? '').toUpperCase() !== 'ALLOW') {
      throw new HttpError(403, 'Self-improvement candidate was denied by agent governance', 'self_improvement_governance_denied');
    }
  }

  const { data: candidate, error } = await admin().from('agent_improvement_candidates').insert({
    production_id: input.productionId,
    agent_id: input.agent.id,
    run_id: input.runId ?? null,
    config_version_from: input.agent.active_config_version ?? 1,
    type: proposal.type,
    current_value: proposal.current_value ?? JSON.stringify(input.agent.strategy_config ?? {}),
    proposed_value: proposal.proposed_value,
    rationale: proposal.rationale ?? null,
    evidence: proposal.evidence ?? {},
    estimated_cost: estimated,
    actual_cost: estimated,
    status: 'PROPOSED',
  }).select('*').single();
  if (error) throw new Error(`store self-improvement candidate: ${error.message}`);
  await admin().from('agent_budget_ledger').insert({
    production_id: input.productionId,
    agent_id: input.agent.id,
    run_id: input.runId ?? null,
    category: 'SELF_IMPROVEMENT',
    amount: estimated,
    currency: state.policy.budget.currency,
    units: 1,
    metadata: { candidateId: candidate.id, type: proposal.type },
  });
  return candidate;
}

export async function decideImprovement(input: { userId: string; productionId: string; agent: any; candidateId: string; decision: 'approve' | 'reject' }) {
  const { data: candidate, error } = await admin().from('agent_improvement_candidates').select('*').eq('id', input.candidateId).eq('production_id', input.productionId).eq('agent_id', input.agent.id).single();
  if (error || !candidate) throw new HttpError(404, 'Self-improvement candidate not found', 'self_improvement_not_found');
  if (candidate.status !== 'PROPOSED') throw new HttpError(409, 'Self-improvement candidate already has a terminal decision', 'self_improvement_already_decided');
  if (input.decision === 'reject') {
    const { data } = await admin().from('agent_improvement_candidates').update({ status: 'REJECTED', approved_by: input.userId, approved_at: new Date().toISOString() }).eq('id', candidate.id).select('*').single();
    return data;
  }
  // Promotion never changes tools, permissions, data classes, model, policy, or budget.
  const nextVersion = Number(input.agent.active_config_version ?? 1) + 1;
  const nextStrategy = { ...(input.agent.strategy_config ?? {}), [candidate.type]: candidate.proposed_value };
  await admin().from('agent_config_versions').insert({
    production_id: input.productionId,
    agent_id: input.agent.id,
    version: nextVersion,
    strategy_config: nextStrategy,
    source_candidate_id: candidate.id,
    created_by: input.userId,
  });
  await admin().from('production_agents').update({ strategy_config: nextStrategy, active_config_version: nextVersion, updated_at: new Date().toISOString() }).eq('id', input.agent.id);
  const { data } = await admin().from('agent_improvement_candidates').update({ status: 'PROMOTED', approved_by: input.userId, approved_at: new Date().toISOString() }).eq('id', candidate.id).select('*').single();
  return data;
}
