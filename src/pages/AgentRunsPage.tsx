import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useOptraneState } from '../state/OptraneState';
import type { AgentEvidence, AgentRun } from '../types/optrane';

export function AgentRunsPage({ onToast }: { onToast: (message: string) => void }) {
  const state = useOptraneState();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [evidence, setEvidence] = useState<AgentEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!state.activeAgentId) return;
    setLoading(true);
    try {
      const [nextRuns, nextEvidence] = await Promise.all([api.getAgentRuns(state.activeProductionId, state.activeAgentId), api.getAgentEvidence(state.activeProductionId, state.activeAgentId)]);
      setRuns(nextRuns); setEvidence(nextEvidence);
    } catch (error) { onToast(error instanceof Error ? error.message : 'Could not load agent evidence'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [state.activeAgentId, state.activeProductionId]);

  const startRun = async () => {
    if (!state.activeAgentId) return;
    setBusy(true);
    try {
      const run = await api.startAgentRun(state.activeProductionId, state.activeAgentId, { purpose: 'OPTRANE governed desktop run', budget: { currency: 'USD', maximum: 1 } });
      onToast(`Governed run ${run.governanceRunId ?? run.id} started through OPTRANE.`);
      await load();
    } catch (error) { onToast(error instanceof Error ? error.message : 'Could not start governed run'); }
    finally { setBusy(false); }
  };

  const verifyRead = async () => {
    if (!state.activeAgentId) return;
    setBusy(true);
    try {
      const decision = await api.authorizeAgentAction(state.activeProductionId, state.activeAgentId, {
        action: 'TOOL_CALL',
        tool: 'clickhouse.run_query',
        resource: { type: 'PRODUCTION', id: state.activeProductionId },
        dataClasses: ['SCENE_BREAKDOWN', 'SCHEDULE'],
        estimatedCost: { currency: 'USD', amount: 0.01 },
      });
      onToast(`Governance decision: ${decision.decision}${decision.reason ? ` — ${decision.reason}` : ''}`);
      await load();
    } catch (error) { onToast(error instanceof Error ? error.message : 'Authorization check failed'); }
    finally { setBusy(false); }
  };

  return <section className="page">
    <div className="page-head"><div><span className="eyebrow">GOVERNANCE EVIDENCE</span><h1>Runs & Governance Trail</h1><p>Every operation goes desktop → OPTRANE Lovable gateway → private governance layer. Provider endpoints and native policy logic are never exposed to the desktop.</p></div><div className="button-row"><button className="ghost" disabled={busy} onClick={() => void verifyRead()}>Verify ClickHouse read</button><button className="primary" disabled={busy} onClick={() => void startRun()}>Start governed run</button><button className="ghost" onClick={() => state.setScreen('agent-detail')}>Back to agent</button></div></div>
    {loading ? <div className="empty-state">Loading governance evidence…</div> : <div className="runs-layout">
      <div className="panel"><div className="panel-head"><div><span className="eyebrow">RUNS</span><h3>Agent executions</h3></div><span className="count-pill">{runs.length}</span></div>{runs.length === 0 ? <div className="empty-small">No governed runs yet.</div> : <div className="run-list">{runs.map((run) => <div className="run-row" key={run.id}><div className={`run-lamp run-${run.status.toLowerCase()}`}/><div><b>{run.purpose}</b><small>{run.governanceRunId ?? run.id}</small></div><span>{run.status}</span><div className="run-cost"><b>${run.spent ?? 0}</b><small>of ${run.budgetLimit ?? '—'}</small></div></div>)}</div>}</div>
      <div className="panel"><div className="panel-head"><div><span className="eyebrow">EVIDENCE</span><h3>Authorization & actions</h3></div><span className="count-pill">{evidence.length}</span></div>{evidence.length === 0 ? <div className="empty-small">No evidence events recorded yet.</div> : <div className="evidence-list">{evidence.map((item) => <div key={item.id} className="evidence-row"><div className={`decision-dot decision-${(item.decision ?? 'allow').toLowerCase()}`}/><div><b>{item.tool ?? item.eventType}</b><p>{item.summary}</p><small>{new Date(item.createdAt).toLocaleString()}</small></div><span>{item.decision ?? (item.success ? 'SUCCESS' : 'EVENT')}</span></div>)}</div>}</div>
    </div>}
  </section>;
}
