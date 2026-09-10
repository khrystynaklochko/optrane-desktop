import { useEffect } from 'react';
import { api } from '../api/client';
import { DependencyGraph } from '../components/DependencyGraph';
import { useOptraneState } from '../state/OptraneState';

export function GraphPage({ onToast }: { onToast: (message: string) => void }) {
  const state = useOptraneState();
  useEffect(() => {
    api.getGraph(state.activeProductionId).then(state.setGraph).catch((error: unknown) => onToast(error instanceof Error ? error.message : 'Graph unavailable'));
  }, [state.activeProductionId]);
  return <section className="page"><span className="eyebrow">PRODUCTION GRAPH</span><h1>Production dependency blast radius.</h1><p className="lede">Read-only graph generated from deterministic production dependencies. Affected and verification-required nodes are highlighted; the graph itself is not editable.</p>
    <div className="panel graph-panel">{state.graph ? <DependencyGraph graph={state.graph}/> : <div className="graph-loading">Loading dependency graph…</div>}</div>
    <button className="ghost" onClick={() => state.setScreen('impact')}>← Back to Impact</button>
  </section>;
}
