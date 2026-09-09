import type { AnalysisEvent, ConnectionState } from '../types/optrane';

const ACTORS = [
  'Change Agent',
  'ClickHouse',
  'Google Agent Runtime',
  'ClickHouse MCP',
  'Impact Agent',
  'Recovery Agent',
  'Production Director',
];

export function AgentTimeline({ events, connection }: { events: AnalysisEvent[]; connection: ConnectionState }) {
  const latestByActor = new Map<string, AnalysisEvent>();
  for (const event of events) latestByActor.set(event.actor, event);
  const mcp = [...events].reverse().find((event) => event.type === 'MCP_QUERY_COMPLETE');
  const runtime = [...events].reverse().find((event) => event.type === 'AGENT_RUNTIME_COMPLETE');

  return <div className="agent-timeline panel">
    <div className="panel-head"><div><span className="eyebrow">PRODUCTION CREW</span><h2>Live cloud + agent execution</h2></div><span className={`connection connection-${connection.toLowerCase()}`}>{connection.replaceAll('_', ' ')}</span></div>
    {ACTORS.map((actor) => {
      const event = latestByActor.get(actor);
      const done = event?.status === 'COMPLETE' || event?.type.endsWith('_COMPLETE') || event?.type === 'CHANGE_DETECTED' || event?.type === 'CLICKHOUSE_FACTS_MIRRORED';
      const failed = event?.status === 'FAILED';
      return <div className="agent-row" key={actor}>
        <span className={`agent-lamp ${done ? 'done' : failed ? 'failed' : event ? 'running' : ''}`} />
        <div><b>{actor}</b><small>{event?.message ?? 'Waiting for upstream work'}</small></div>
        <strong>{failed ? '!' : done ? '✓' : event ? '●' : '○'}</strong>
      </div>;
    })}
    {runtime && <div className="runtime-inline"><span>GOOGLE ADK</span><b>{runtime.payload?.tool_call_observed ? 'tool call observed' : 'runtime completed'}</b><b>{runtime.payload?.model ? String(runtime.payload.model) : 'Gemini'}</b></div>}
    {mcp && <div className="mcp-inline"><span className="status-dot"/><b>{String(mcp.payload?.tool ?? 'run_query')} verified through official ClickHouse MCP</b><small>{Number(mcp.payload?.row_count ?? 0)} rows · {mcp.payload?.read_only ? 'READ ONLY' : 'policy controlled'}</small></div>}
  </div>;
}
