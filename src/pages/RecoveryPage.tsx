import { useState } from 'react';
import { api } from '../api/client';
import { Metric } from '../components/Metric';
import { useOptraneState } from '../state/OptraneState';
import { useNotifications } from '../hooks/useNotifications';
import type { RecoveryPlan } from '../types/optrane';

export function RecoveryPage({ onToast }: { onToast: (message: string) => void }) {
  const state = useOptraneState();
  const notify = useNotifications();
  const [busyPlan, setBusyPlan] = useState<string | null>(null);

  async function approve(plan: RecoveryPlan) {
    setBusyPlan(plan.id);
    try {
      const result = await api.approvePlan(state.activeProductionId, plan.id);
      state.setSelectedPlanId(plan.id);
      state.setProduction((p) => ({ ...p, readiness: result.readiness }));
      const artifacts = await api.getArtifacts(state.activeProductionId, plan.id);
      state.setArtifacts(artifacts.artifacts);
      state.setAudit((await api.getAudit(state.activeProductionId)).events);
      state.setScreen('audit');
      await notify('Recovery plan approved', `Plan ${plan.code} applied. Production readiness is now ${result.readiness}%.`);
      onToast(`Plan ${plan.code} approved. Production readiness is now ${result.readiness}%.`);
    } catch (error) { onToast(error instanceof Error ? error.message : 'Approval failed'); }
    finally { setBusyPlan(null); }
  }

  async function reject(plan: RecoveryPlan) {
    setBusyPlan(plan.id);
    try {
      await api.rejectPlan(state.activeProductionId, plan.id, 'Rejected during recovery review');
      state.setAudit((await api.getAudit(state.activeProductionId)).events);
      onToast(`Plan ${plan.code} rejected. No production state changed.`);
    } catch (error) { onToast(error instanceof Error ? error.message : 'Rejection failed'); }
    finally { setBusyPlan(null); }
  }

  return <section className="page"><span className="eyebrow">RECOVERY OPTIONS</span><h1>Choose the least expensive safe path.</h1><p className="lede">These are proposals only. Nothing changes until the producer approves one plan.</p>
    {!state.plans.length && <div className="panel empty-state"><h2>No recovery plans yet.</h2><p>Complete an impact analysis first.</p><button className="ghost" onClick={() => state.setScreen('impact')}>Return to Impact</button></div>}
    <div className="plans">{state.plans.map((plan) => <article className={`plan ${plan.recommended ? 'recommended' : ''}`} key={plan.id}>{plan.recommended && <div className="ribbon">RECOMMENDED</div>}<span className="plan-code">PLAN {plan.code}</span><h2>{plan.title}</h2><div className="plan-grid"><Metric value={`${plan.costDelta >= 0 ? '+' : ''}$${(plan.costDelta/1000).toFixed(1)}K`} label="Cost delta"/><Metric value={`${plan.scheduleDeltaMinutes}m`} label="Schedule"/><Metric value={plan.risk} label="Risk"/><Metric value={plan.changes} label="Changes"/></div><h4>Actions</h4><ul>{plan.actions.map((a) => <li key={a}>{a}</li>)}</ul><p className="assumption">Demo assumptions: {plan.assumptions.join('; ')}</p><div className="plan-actions"><button className="ghost" disabled={busyPlan === plan.id} onClick={() => reject(plan)}>Reject</button><button className={plan.recommended ? 'primary grow' : 'ghost grow'} disabled={busyPlan === plan.id} onClick={() => approve(plan)}>{busyPlan === plan.id ? 'Applying…' : `Approve Plan ${plan.code}`}</button></div></article>)}</div>
  </section>;
}
