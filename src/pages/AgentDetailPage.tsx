import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useOptraneState } from '../state/OptraneState';
import type { ImprovementCandidate, ProductionAgent } from '../types/optrane';

export function AgentDetailPage({ onToast }: { onToast: (message: string) => void }) {
  const state = useOptraneState();
  const [agent, setAgent] = useState<ProductionAgent | null>(null);
  const [improvements, setImprovements] = useState<ImprovementCandidate[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!state.activeAgentId) return;
    try {
      const [nextAgent, nextImprovements] = await Promise.all([
        api.getAgent(state.activeProductionId, state.activeAgentId),
        api.listAgentImprovements(state.activeProductionId, state.activeAgentId),
      ]);
      setAgent(nextAgent); setImprovements(nextImprovements);
    } catch (error) { onToast(error instanceof Error ? error.message : 'Could not load agent'); }
  }, [state.activeAgentId, state.activeProductionId, onToast]);
  useEffect(() => { void load(); }, [load]);

  const act = async (task: () => Promise<ProductionAgent>, success: string) => {
    setBusy(true);
    try { const next = await task(); setAgent(next); onToast(success); }
    catch (error) { onToast(error instanceof Error ? error.message : 'Agent operation failed'); }
    finally { setBusy(false); }
  };

  const proposeImprovement = async () => {
    if (!agent) return;
    setBusy(true);
    try {
      const candidate = await api.proposeAgentImprovement(state.activeProductionId, agent.id, { evidence: { source: 'OPTRANE desktop request' } });
      setImprovements((current) => [candidate, ...current]);
      await load();
      onToast('Gemini proposed one bounded self-improvement candidate. Nothing was applied automatically.');
    } catch (error) { onToast(error instanceof Error ? error.message : 'Could not create self-improvement candidate'); }
    finally { setBusy(false); }
  };

  const decide = async (candidate: ImprovementCandidate, decision: 'approve' | 'reject') => {
    if (!agent) return;
    setBusy(true);
    try {
      const next = await api.decideAgentImprovement(state.activeProductionId, agent.id, candidate.id, decision);
      setImprovements((current) => current.map((item) => item.id === next.id ? next : item));
      await load();
      onToast(decision === 'approve' ? 'Self-improvement promoted as a new immutable strategy version.' : 'Self-improvement rejected.');
    } catch (error) { onToast(error instanceof Error ? error.message : 'Could not decide self-improvement'); }
    finally { setBusy(false); }
  };

  if (!state.activeAgentId) return <section className="page"><div className="empty-state">Select an agent from the fleet first.</div></section>;
  if (!agent) return <section className="page"><div className="empty-state">Loading governed agent…</div></section>;

  const governance = agent.governance;
  const self = agent.selfImprovement;
  const revoke = () => {
    if (!window.confirm(`Revoke ${agent.name}? Historical evidence will be preserved, but the agent will no longer be allowed to run.`)) return;
    void act(() => api.revokeAgent(state.activeProductionId, agent.id, 'Revoked by OPTRANE producer'), 'Agent revoked by the governance backend.');
  };

  return <section className="page agent-detail-page">
    <div className="page-head"><div><span className="eyebrow">GOVERNED AGENT</span><h1>{agent.name}</h1><p>{agent.purpose}</p></div><div className="button-row top"><button className="ghost" onClick={() => state.setScreen('agents')}>Back to fleet</button><button className="ghost" onClick={() => state.setScreen('agent-runs')}>Runs & evidence</button></div></div>

    <div className="passport-hero panel">
      <div className="passport-seal">AI</div>
      <div className="passport-main"><span className="eyebrow">GOVERNANCE PASSPORT</span><h2>{governance?.passportId ?? 'Passport not issued'}</h2><div className="passport-meta"><span>{agent.agentType}</span><span>{agent.runtime}</span><span>{agent.model ?? 'model unspecified'}</span>{governance?.provider && <span>{governance.provider}</span>}</div></div>
      <div className="passport-trust"><span>TRUST SCORE</span><strong>{governance?.trustScore ?? '—'}</strong><small>{governance?.trustStatus ?? agent.status}</small></div>
    </div>

    {agent.status === 'REGISTRATION_FAILED' && <div className="error-panel"><b>Governed identity registration failed</b><span>{agent.registrationError ?? 'The backend could not complete private passport provisioning.'}</span><button className="primary" disabled={busy} onClick={() => void act(() => api.retryAgentRegistration(state.activeProductionId, agent.id), 'Registration retried through OPTRANE backend.')}>Retry registration</button></div>}

    <div className="agent-detail-grid">
      <div className="panel"><div className="panel-head"><div><span className="eyebrow">CAPABILITIES</span><h3>Declared abilities</h3></div><span className="count-pill">{agent.capabilities.length}</span></div><div className="tag-cloud">{agent.capabilities.map((item) => <span key={item.capability}>{item.capability.replaceAll('_',' ')}</span>)}</div></div>
      <div className="panel"><div className="panel-head"><div><span className="eyebrow">TOOLS</span><h3>Bound interfaces</h3></div><span className="count-pill">{agent.tools.length}</span></div><div className="tool-detail-list">{agent.tools.map((tool) => <div key={tool.toolKey}><div><b>{tool.toolKey}</b><small>{tool.provider}</small></div><span>{tool.accessMode}</span></div>)}</div></div>
      <div className="panel"><div className="panel-head"><div><span className="eyebrow">DATA CLEARANCE</span><h3>Granted classes</h3></div></div><div className="data-detail-list">{agent.dataClasses.map((item) => <div key={item.dataClass}><span>{item.dataClass.replaceAll('_',' ')}</span><b className={`access-${item.access.toLowerCase()}`}>{item.access}</b></div>)}</div></div>
      <div className="panel"><span className="eyebrow">EXECUTION BUDGET</span><div className="budget-big"><strong>${agent.budget?.perRun ?? '—'}</strong><span>per run</span></div><div className="budget-meter"><i style={{ width: `${Math.min(100, ((agent.budget?.spentToday ?? 0) / Math.max(agent.budget?.daily ?? 1, 1)) * 100)}%` }}/></div><div className="budget-row"><span>Spent today</span><b>${agent.budget?.spentToday ?? 0}</b></div><div className="budget-row"><span>Daily limit</span><b>${agent.budget?.daily ?? '—'}</b></div><div className="budget-row"><span>Passport version</span><b>{governance?.passportVersion ?? '—'}</b></div><div className="budget-row"><span>Last governance sync</span><b>{governance?.lastSyncAt ? new Date(governance.lastSyncAt).toLocaleString() : '—'}</b></div></div>
    </div>

    {self && <div className="panel self-improvement-panel">
      <div className="panel-head"><div><span className="eyebrow">SELF-IMPROVEMENT POLICY</span><h3>Gemini may improve strategy, never authority</h3></div><span className={`agent-status ${self.enabled ? 'status-active' : 'status-restricted'}`}>{self.enabled ? 'ENABLED' : 'DISABLED'}</span></div>
      <div className="improvement-rule-card"><span>RULE EXECUTED BY THE AGENT</span><p>{self.rule}</p><div className="rule-split"><div><b>Allowed changes</b><small>{self.allowed.map((item) => item.replaceAll('_',' ')).join(' · ')}</small></div><div><b>Hard boundaries</b><small>Tools · permissions · data access · model · code · governance policy · budgets · secrets</small></div></div></div>
      <div className="improvement-budget-grid"><div><span>PER ITERATION</span><strong>${self.budget.perIteration}</strong></div><div><span>DAILY CAP</span><strong>${self.budget.daily}</strong></div><div><span>REMAINING TODAY</span><strong>${self.budget.remainingToday ?? self.budget.daily}</strong></div><div><span>ITERATIONS / RUN</span><strong>{self.budget.maxIterationsPerRun}</strong></div><div><span>USED TODAY</span><strong>{self.budget.iterationsToday ?? 0}</strong></div></div>
      <div className="human-gate"><b>No recursive permission escalation</b><span>The model only returns a candidate. The backend validates type and cost, records budget spend, and requires a producer to promote the candidate into a new immutable strategy version.</span></div>
      <div className="button-row"><button className="primary" disabled={busy || !self.enabled || (self.budget.remainingToday ?? self.budget.daily) <= 0} onClick={() => void proposeImprovement()}>{busy ? 'Working…' : 'Ask Gemini for one improvement'}</button></div>
    </div>}

    <div className="panel"><div className="panel-head"><div><span className="eyebrow">IMPROVEMENT CANDIDATES</span><h3>Human-approved strategy versions</h3></div><span className="count-pill">{improvements.length}</span></div>{improvements.length === 0 ? <div className="empty-small">No self-improvement candidates yet.</div> : <div className="improvement-list">{improvements.map((candidate) => <div className="improvement-row" key={candidate.id}><div><span className="eyebrow">{candidate.type.replaceAll('_',' ')}</span><b>{candidate.proposedValue}</b><p>{candidate.rationale}</p><small>Estimated cost ${candidate.estimatedCost.toFixed(2)} · {new Date(candidate.createdAt).toLocaleString()}</small></div><div><strong>{candidate.status}</strong>{candidate.status === 'PROPOSED' && <div className="button-row"><button className="ghost" disabled={busy} onClick={() => void decide(candidate, 'reject')}>Reject</button><button className="primary" disabled={busy} onClick={() => void decide(candidate, 'approve')}>Approve & promote</button></div>}</div></div>)}</div>}</div>

    <div className="panel governance-panel"><div><span className="eyebrow">GOVERNANCE CONTROL</span><h3>Provider-native enforcement stays behind OPTRANE</h3><p>The desktop sees normalized trust, budget and decisions only. Private peer signing, provider endpoints, policy payloads and credentials never cross the Lovable gateway.</p></div><div className="button-row"><button className="ghost" disabled={busy} onClick={() => void act(() => api.syncAgent(state.activeProductionId, agent.id), 'Governance passport synchronized.')}>Sync passport</button>{agent.status !== 'REVOKED' && <button className="danger-button" disabled={busy} onClick={revoke}>Revoke agent</button>}</div></div>
  </section>;
}
