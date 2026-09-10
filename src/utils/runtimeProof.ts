import type { AnalysisEvent, RuntimeProof } from '../types/optrane';

function payloadNumber(event: AnalysisEvent | undefined, key: string): number {
  const value = event?.payload?.[key];
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function payloadBoolean(event: AnalysisEvent | undefined, key: string): boolean {
  const value = event?.payload?.[key];
  return value === true || value === 'true' || value === 1;
}

export function deriveRuntimeProof(events: AnalysisEvent[]): RuntimeProof {
  const mirrored = [...events].reverse().find((event) => event.type === 'CLICKHOUSE_FACTS_MIRRORED');
  const runtimeStarted = events.some((event) => event.type === 'AGENT_RUNTIME_STARTED');
  const runtimeComplete = [...events].reverse().find((event) => event.type === 'AGENT_RUNTIME_COMPLETE');
  const mcpStarted = events.some((event) => event.type === 'MCP_QUERY_STARTED');
  const mcpComplete = [...events].reverse().find((event) => event.type === 'MCP_QUERY_COMPLETE');

  const agentRuntimeVerified = Boolean(runtimeComplete) && payloadBoolean(runtimeComplete, 'used_agent_runtime');
  const toolCallObserved = payloadBoolean(runtimeComplete, 'tool_call_observed') || payloadBoolean(mcpComplete, 'tool_call_observed');
  const toolResponseObserved = payloadBoolean(runtimeComplete, 'tool_response_observed') || payloadBoolean(mcpComplete, 'tool_response_observed');
  const source = typeof mcpComplete?.payload?.source === 'string' ? mcpComplete.payload.source : undefined;

  return {
    clickhouseMirrored: Boolean(mirrored),
    mirroredRows: payloadNumber(mirrored, 'rows'),
    agentRuntimeStarted: runtimeStarted,
    agentRuntimeVerified,
    adkVerified: agentRuntimeVerified && toolCallObserved && toolResponseObserved,
    geminiModel: typeof runtimeComplete?.payload?.model === 'string' ? runtimeComplete.payload.model : undefined,
    mcpStarted,
    mcpVerified: Boolean(mcpComplete) && toolCallObserved && toolResponseObserved && source === 'MCP_CLICKHOUSE',
    mcpTool: typeof mcpComplete?.payload?.tool === 'string' ? String(mcpComplete.payload.tool) : 'run_query',
    mcpRows: payloadNumber(mcpComplete, 'row_count'),
    source,
    readOnly: mcpComplete ? payloadBoolean(mcpComplete, 'read_only') : true,
  };
}
