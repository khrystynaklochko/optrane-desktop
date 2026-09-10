import { AgentTimeline } from '../components/AgentTimeline';
import { RuntimeProofCard } from '../components/RuntimeProofCard';
import { SeverityPill } from '../components/SeverityPill';
import { useOptraneState } from '../state/OptraneState';

function failureHint(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('agent runtime')) return 'Google Agent Runtime did not return the required ADK execution evidence. Check the deployed reasoning engine and service-account permissions.';
  if (lower.includes('mcp')) return 'The official ClickHouse MCP path could not complete run_query. Check the MCP Cloud Run service, bearer token, and ClickHouse reader credentials.';
  if (lower.includes('clickhouse')) return 'Production facts could not be mirrored or queried in ClickHouse. Check the ClickHouse writer connection and optrane schema.';
  return 'The backend stopped the run before any production mutation. The uploaded revision remains intact and can be retried after fixing the integration.';
}

export function ImpactPage() {
  const state = useOptraneState();
  const unresolved = state.impacts.filter((x) => x.status !== 'RESOLVED').length;
  const complete = state.connectionState === 'COMPLETE' || (!!state.impacts.length && !state.activeAnalysisId);
  const failedEvent = [...state.analysisEvents].reverse().find((event) => event.type === 'ANALYSIS_FAILED');

  return <section className="page">
    <div className="impact-header"><div><span className="eyebrow">REVISION IMPACT</span><h1>{complete ? `${state.changes.length} material changes. ${unresolved} unresolved findings.` : state.connectionState === 'FAILED' ? 'Analysis stopped before production state changed.' : 'Tracing the production blast radius…'}</h1></div><div className="score-shift"><span>{state.readinessBefore}%</span><i>→</i><strong>{complete ? `${state.readinessAfter}%` : '—'}</strong><small>readiness</small></div></div>
    <div className="change-strip">{state.changes.filter((c) => !c.ignored).map((c) => <span key={c.id}>+ {c.label}</span>)}</div>

    {(state.activeAnalysisId || state.analysisEvents.length > 0) && <RuntimeProofCard events={state.analysisEvents} connection={state.connectionState}/>}    
    {state.activeAnalysisId && state.connectionState !== 'COMPLETE' && state.connectionState !== 'FAILED' && <AgentTimeline events={state.analysisEvents} connection={state.connectionState}/>}    

    {state.connectionState === 'FAILED' && <div className="error-panel integration-error"><b>Strict cloud analysis failed.</b><span>{failedEvent?.message ?? 'The backend or cloud agent runtime returned an error.'}</span><small>{failureHint(failedEvent?.message ?? '')}</small><div className="button-row"><button className="ghost" onClick={() => state.setScreen('settings')}>Check Integrations</button><button className="primary" onClick={() => state.setScreen('change-review')}>Retry from Review</button></div></div>}

    {!!state.impacts.length && <>
      <div className="impact-list">{state.impacts.map((x) => {
        const sceneMatch = x.category.match(/scene\s*(\d+)/i) ?? x.reason.match(/scene\s*(\d+)/i);
        const sceneNumber = sceneMatch?.[1];
        return <article className="impact-row" key={x.id}><SeverityPill severity={x.severity}/><div><h3>{x.category}</h3><p>{x.reason}</p><small>Production evidence · {x.evidence}</small>{x.evidenceRefs?.some((ref) => ref.source === 'MCP_CLICKHOUSE') && <span className="evidence-source">MCP_CLICKHOUSE</span>}</div><div className="impact-actions"><b>{x.status.replaceAll('_',' ')}</b><button type="button" className="ghost" onClick={() => { state.setResearchDraft({ question: sceneNumber ? `Scene ${sceneNumber} — ${x.reason}` : x.reason, context: x.evidence, sceneNumber }); state.setScreen('research'); }}>Location Scout →</button></div></article>;
      })}</div>
      <div className="mcp-proof"><span className="status-dot"/><div><b>Production evidence came from the governed read-only path</b><small>Google ADK invokes official mcp-clickhouse `run_query`. Deterministic backend services remain the only writers to production state.</small></div></div>
      <div className="button-row"><button className="ghost" onClick={() => state.setScreen('graph')}>Open Scene 42 graph</button><button className="primary" onClick={() => state.setScreen('recovery')}>Compare Recovery Plans →</button></div>
    </>}
  </section>;
}
