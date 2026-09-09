import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { defaultFleetTypes, templateFor } from '../agents/templates';
import { useOptraneState } from '../state/OptraneState';
import type { ProductionAgent } from '../types/optrane';

function trustClass(status?: string) {
  if (status === 'TRUSTED' || status === 'VERIFIED') return 'trust-good';
  if (status === 'CONDITIONAL' || status === 'REVIEW_REQUIRED') return 'trust-warn';
  if (status === 'RESTRICTED' || status === 'REVOKED') return 'trust-bad';
  return 'trust-neutral';
}

export function AgentsPage({ onToast }: { onToast: (message: string) => void }) {
  const state = useOptraneState();
  const [agents, setAgents] = useState<ProductionAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [fleetBusy, setFleetBusy] = useState(false);
  const [fleetProgress, setFleetProgress] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setAgents(await api.listAgents(state.activeProductionId)); }
    catch (error) { onToast(error instanceof Error ? error.message : 'Could not load agent fleet'); }
    finally { setLoading(false); }
  }, [state.activeProductionId, onToast]);

  useEffect(() => { void load(); }, [load]);

  const openAgent = (agent: ProductionAgent) => {
    state.setActiveAgentId(agent.id);
    state.setScreen('agent-detail');
  };

  const initializeFleet = async () => {
    setFleetBusy(true);
    try {
      const existing = new Set(agents.map((a) => a.agentType));
      const missing = defaultFleetTypes.filter((type) => !existing.has(type));
      if (!missing.length) { onToast('Default production crew is already registered.'); return; }
      setFleetProgress(`Registering ${missing.length} governed agents through the OPTRANE backend…`);
      await api.registerFleet(state.activeProductionId, {
        agentTypes: missing,
        agent_types: missing,
        templates: missing.map((type) => templateFor(type)),
      });
      onToast('Production AI crew registered and governance passports provisioned server-side.');
      await load();
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Agent fleet registration failed');
    } finally { setFleetBusy(false); setFleetProgress(''); }
  };

  const active = agents.filter((a) => a.status === 'ACTIVE').length;
  const governed = agents.filter((a) => !!a.governance?.passportId).length;
  const improving = agents.filter((a) => a.selfImprovement?.enabled).length;
  const needsAttention = agents.filter((a) => ['REGISTRATION_FAILED','RESTRICTED','REVOKED'].includes(a.status)).length;

  return <section className="page agents-page">
    <div className="page-head">
      <div><span className="eyebrow">GOVERNED AGENT FLEET</span><h1>Production Agent Fleet</h1><p>Every operational agent receives a server-provisioned governance passport, explicit permissions, execution budget, self-improvement cap and evidence trail.</p></div>
      <div className="button-row top"><button className="ghost" disabled={fleetBusy} onClick={() => void initializeFleet()}>{fleetBusy ? 'Registering fleet…' : 'Initialize AI Production Crew'}</button><button className="primary" onClick={() => state.setScreen('agent-register')}>Register Agent</button></div>
    </div>

    <div className="agent-summary-grid">
      <div className="panel agent-summary"><span>REGISTERED</span><strong>{agents.length}</strong><small>production identities</small></div>
      <div className="panel agent-summary"><span>ACTIVE</span><strong>{active}</strong><small>cleared for operation</small></div>
      <div className="panel agent-summary"><span>GOVERNED</span><strong>{governed}</strong><small>passports linked</small></div>
      <div className="panel agent-summary"><span>SELF-IMPROVING</span><strong>{improving}</strong><small>bounded + approval gated</small></div>
      <div className="panel agent-summary"><span>ATTENTION</span><strong>{needsAttention}</strong><small>restricted / failed</small></div>
    </div>

    {fleetProgress && <div className="fleet-progress"><span className="spinner"/> {fleetProgress}</div>}

    {loading ? <div className="empty-state">Loading governed agents…</div> : agents.length === 0 ? <div className="panel empty-agent-panel">
      <div className="passport-ghost">AI</div><h2>No production agents registered</h2><p>Register a specialist or initialize the default Director, Breakdown, Revision, Impact and Recovery fleet.</p><button className="primary" onClick={() => state.setScreen('agent-register')}>Register first agent</button>
    </div> : <div className="agent-grid">
      {agents.map((agent) => <button key={agent.id} className="agent-card panel" onClick={() => openAgent(agent)}>
        <div className="agent-card-top"><div className="agent-role-icon">{agent.agentType.slice(0,2)}</div><div className="agent-status-stack"><span className={`agent-status status-${agent.status.toLowerCase()}`}>{agent.status.replaceAll('_',' ')}</span><span className={`trust-status ${trustClass(agent.governance?.trustStatus)}`}>{agent.governance?.trustStatus ?? 'UNREGISTERED'}</span></div></div>
        <span className="eyebrow">{agent.agentType}</span><h2>{agent.name}</h2><p>{agent.purpose}</p>
        <div className="passport-strip"><div><span>GOVERNANCE PASSPORT</span><b>{agent.governance?.passportId ?? 'Pending passport'}</b></div><div className="trust-score"><span>TRUST</span><strong>{agent.governance?.trustScore ?? '—'}</strong></div></div>
        <div className="agent-mini-grid"><span>{agent.capabilities.length}<small>capabilities</small></span><span>{agent.tools.length}<small>tools</small></span><span>{agent.budget?.perRun ? `$${agent.budget.perRun}` : '—'}<small>run cap</small></span><span>{agent.selfImprovement?.budget.perIteration ? `$${agent.selfImprovement.budget.perIteration}` : '—'}<small>improve cap</small></span></div>
      </button>)}
    </div>}
  </section>;
}
