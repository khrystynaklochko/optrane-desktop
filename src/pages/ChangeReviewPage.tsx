import { useState } from 'react';
import { api, usesHostedGateway } from '../api/client';
import { useOptraneState } from '../state/OptraneState';

export function ChangeReviewPage({ onToast }: { onToast: (message: string) => void }) {
  const state = useOptraneState();
  const [busy, setBusy] = useState(false);
  const visible = state.changes.filter((c) => !c.ignored);

  function ignore(id: string) {
    state.setChanges(state.changes.map((c) => c.id === id ? { ...c, ignored: true } : c));
  }

  async function analyse() {
    setBusy(true);
    try {
      const revisionVersion = Math.max(
        state.activeRevisionVersion,
        state.production.currentScriptVersion,
        1,
      );
      if (!usesHostedGateway()) {
        const health = await api.integrationHealth();
        if (health.strictMode && !health.strictMode.ready) {
          onToast('Strict cloud execution is not ready. Fix Agent Runtime / ClickHouse MCP integrations first.');
          state.setScreen('settings');
          return;
        }
      }
      state.setAnalysisEvents([]); state.setImpacts([]); state.setPlans([]);
      const started = await api.startAnalysis(
        state.activeProductionId,
        revisionVersion,
        state.activeScriptVersionId ?? undefined,
      );
      state.setActiveAnalysisId(started.analysisId);
      state.setConnectionState('CONNECTING');
      state.setScreen('impact');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analysis could not start';
      onToast(message);
      if (/upload a screenplay revision|upload a baseline/i.test(message)) state.setScreen('revision');
    } finally { setBusy(false); }
  }

  return <section className="page narrow-left">
    <span className="eyebrow">SCRIPT REVISION {state.activeRevisionVersion}</span><h1>{visible.length || 'New'} material changes</h1>
    {visible.length ? <><div className="scene-card"><div className="scene-heading"><b>SCENE 42</b><span>EXT. OLD WAREHOUSE / NIGHT</span></div>{visible.map((change) => <div className="change-review-row" key={change.id}><span>+</span><div><b>{change.label}</b><small>{change.category.replaceAll('_',' ')}</small></div><button className="link-button" onClick={() => ignore(change.id)}>Ignore</button></div>)}</div></> : <div className="panel empty-state"><h2>Revision uploaded.</h2><p>The cloud Change Agent will detect and align material changes when you start analysis.</p></div>}
    <div className="human-gate"><b>Human checkpoint</b><span>Detection does not propagate anything downstream until you explicitly analyse and later approve a recovery plan.</span></div>
    <button className="primary" disabled={busy} onClick={analyse}>{busy ? 'Starting cloud analysis…' : 'Analyse with Google ADK + ClickHouse MCP'}</button>
  </section>;
}
