import { env } from './env.ts';
import { googleCloudAccessToken } from './gcp_auth.ts';

export interface AgentRuntimeEvidenceResult {
  rows: Record<string, unknown>[];
  toolCallObserved: boolean;
  toolResponseObserved: boolean;
  finalText: string;
  events: unknown[];
}

export function agentRuntimeConfigured() {
  return Boolean(env.googleAgentEngineResource && env.googleCloudLocation && env.googleServiceAccountJson);
}

function eventDataBlocks(text: string): unknown[] {
  const out: unknown[] = [];
  for (const block of text.split(/\r?\n\r?\n+/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data || data === '[DONE]') continue;
    try { out.push(JSON.parse(data)); } catch { /* keep parsing other events */ }
  }
  return out;
}

function walk(value: unknown, visit: (value: any) => void) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const child of Object.values(value as Record<string, unknown>)) walk(child, visit);
}

function parseRowsFromUnknown(value: unknown): Record<string, unknown>[] {
  const candidates: unknown[] = [value];
  if (typeof value === 'string') {
    try { candidates.push(JSON.parse(value)); } catch { /* not JSON */ }
  }

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.every((row) => row && typeof row === 'object')) {
      return candidate as Record<string, unknown>[];
    }
    if (candidate && typeof candidate === 'object') {
      const obj = candidate as Record<string, unknown>;
      for (const key of ['rows', 'data', 'result', 'structuredContent', 'structured_content']) {
        if (!(key in obj)) continue;
        const nested = parseRowsFromUnknown(obj[key]);
        if (nested.length) return nested;
      }
      const content = obj.content;
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item && typeof item === 'object') {
            const text = (item as any).text;
            if (typeof text === 'string') {
              const nested = parseRowsFromUnknown(text);
              if (nested.length) return nested;
            }
          }
        }
      }
    }
  }
  return [];
}

export async function agentRuntimeReachable() {
  if (!agentRuntimeConfigured()) return false;
  try {
    const token = await googleCloudAccessToken();
    const response = await fetch(
      `https://${encodeURIComponent(env.googleCloudLocation)}-aiplatform.googleapis.com/v1/${env.googleAgentEngineResource}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function queryClickHouseViaAgentRuntime(input: {
  userId: string;
  productionId: string;
  sql: string;
}): Promise<AgentRuntimeEvidenceResult> {
  if (!agentRuntimeConfigured()) {
    throw new Error('GOOGLE_AGENT_ENGINE_RESOURCE / Google Cloud Agent Runtime credentials are not configured');
  }
  if (!/^\s*SELECT\b/i.test(input.sql)) throw new Error('Agent Runtime evidence queries must be SELECT-only');

  const location = env.googleCloudLocation;
  const resource = env.googleAgentEngineResource;
  const url = `https://${encodeURIComponent(location)}-aiplatform.googleapis.com/v1/${resource}:streamQuery?alt=sse`;
  const token = await googleCloudAccessToken();

  const message = [
    'OPTRANE_EVIDENCE_QUERY',
    `production_id=${input.productionId}`,
    'You MUST use the ClickHouse MCP run_query tool exactly once with the SELECT statement below.',
    'Do not rewrite it into a mutation. Do not use another datasource. After the tool returns, briefly summarize the evidence.',
    'SQL:',
    input.sql,
  ].join('\n');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      class_method: 'async_stream_query',
      input: {
        user_id: input.userId.slice(0, 128),
        message,
      },
    }),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`Google Agent Runtime ${response.status}: ${text.slice(0, 1200)}`);
  const events = eventDataBlocks(text);
  if (!events.length) throw new Error('Google Agent Runtime returned no stream events');

  let toolCallObserved = false;
  let toolResponseObserved = false;
  let rows: Record<string, unknown>[] = [];
  let finalText = '';

  for (const event of events) {
    walk(event, (node) => {
      const functionCall = node.function_call ?? node.functionCall;
      if (functionCall?.name === 'run_query') toolCallObserved = true;

      const functionResponse = node.function_response ?? node.functionResponse;
      if (functionResponse?.name === 'run_query') {
        toolResponseObserved = true;
        const parsed = parseRowsFromUnknown(functionResponse.response);
        if (parsed.length) rows = parsed;
      }

      if (typeof node.text === 'string') finalText += node.text;
    });
  }

  if (!toolCallObserved || !toolResponseObserved) {
    throw new Error('Agent Runtime completed without a verified ClickHouse MCP run_query call/response');
  }

  return { rows, toolCallObserved, toolResponseObserved, finalText: finalText.trim(), events };
}

export interface SelfImprovementProposalResult {
  type: string;
  current_value?: string;
  proposed_value: string;
  rationale?: string;
  estimated_cost: number;
  evidence?: Record<string, unknown>;
  finalText: string;
  events: unknown[];
}

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* try next shape */ }
  }
  throw new Error('Agent Runtime self-improvement response was not valid JSON');
}

export async function proposeSelfImprovementViaAgentRuntime(input: {
  userId: string;
  agentId: string;
  currentStrategy: Record<string, unknown>;
  evidence: Record<string, unknown>;
  allowedTypes: string[];
  forbidden: string[];
  remainingBudget: number;
  remainingIterations: number;
  perIterationCap: number;
}): Promise<SelfImprovementProposalResult> {
  if (!agentRuntimeConfigured()) throw new Error('Google Cloud Agent Runtime is not configured');
  const location = env.googleCloudLocation;
  const resource = env.googleAgentEngineResource;
  const url = `https://${encodeURIComponent(location)}-aiplatform.googleapis.com/v1/${resource}:streamQuery?alt=sse`;
  const token = await googleCloudAccessToken();
  const message = [
    'OPTRANE_SELF_IMPROVEMENT_PROPOSAL',
    `agent_id=${input.agentId}`,
    `allowed_types=${JSON.stringify(input.allowedTypes)}`,
    `forbidden=${JSON.stringify(input.forbidden)}`,
    `remaining_improvement_budget_usd=${input.remainingBudget.toFixed(4)}`,
    `per_iteration_cap_usd=${input.perIterationCap.toFixed(4)}`,
    `remaining_iterations=${input.remainingIterations}`,
    `current_strategy=${JSON.stringify(input.currentStrategy)}`,
    `run_evidence=${JSON.stringify(input.evidence)}`,
    'Return one JSON object only. Never apply the candidate yourself.',
  ].join('\n');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ class_method: 'async_stream_query', input: { user_id: input.userId.slice(0, 128), message } }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Google Agent Runtime ${response.status}: ${text.slice(0, 1200)}`);
  const events = eventDataBlocks(text);
  let finalText = '';
  for (const event of events) walk(event, (node) => { if (typeof node.text === 'string') finalText += node.text; });
  let toolCallSeen = false;
  for (const event of events) walk(event, (node) => {
    if (node && typeof node === 'object' && ('function_call' in node || 'functionCall' in node)) toolCallSeen = true;
  });
  if (toolCallSeen) throw new Error('Self-improvement run attempted a tool call; candidate rejected');
  const parsed = extractJsonObject(finalText);
  return {
    type: String(parsed.type ?? ''),
    current_value: parsed.current_value == null ? undefined : String(parsed.current_value),
    proposed_value: String(parsed.proposed_value ?? ''),
    rationale: parsed.rationale == null ? undefined : String(parsed.rationale),
    estimated_cost: Number(parsed.estimated_cost ?? 0),
    evidence: parsed.evidence && typeof parsed.evidence === 'object' ? parsed.evidence as Record<string, unknown> : {},
    finalText: finalText.trim(),
    events,
  };
}
