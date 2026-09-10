import { useEffect, useState } from 'react';
import { api, type EvidenceTrailItem } from '../api/client';
import { useOptraneState } from '../state/OptraneState';

export function AuditPage() {
  const state = useOptraneState();
  const [evidence, setEvidence] = useState<EvidenceTrailItem[]>([]);

  useEffect(() => {
    api.getEvidenceTrail(state.activeProductionId, { limit: 200, kinds: ['audit','ai','analysis','delta'] })
      .then(setEvidence)
      .catch(() => setEvidence([]));
  }, [state.activeProductionId, state.audit.length]);

  return <section className="page narrow-left"><span className="eyebrow">DECISION TRAIL</span><h1>Every change. Every query. Every approval.</h1>
    <div className="timeline">{state.audit.slice().reverse().map((e) => <div className="timeline-row" key={e.id}><time>{e.time}</time><span className="timeline-dot"/><div><b>{e.summary}</b><small>{e.eventType} · {e.actor} · {e.source ?? 'OPTRANE'}</small></div></div>)}</div>
    {!!evidence.length && <div className="artifact-section"><span className="eyebrow">OPTRANE EVIDENCE TRAIL</span>{evidence.slice(0, 30).map((item) => <div className="artifact-card" key={item.id}><b>{item.summary}</b><small>{item.kind.toUpperCase()} · {item.source ?? 'OPTRANE GATEWAY'} · {new Date(item.createdAt).toLocaleString()}</small></div>)}</div>}
    {!!state.artifacts.length && <div className="artifact-section"><span className="eyebrow">APPROVED ARTIFACT DELTAS</span>{state.artifacts.map((artifact) => <div className="artifact-card" key={artifact.kind}><b>{artifact.title}</b><small>{artifact.kind.replaceAll('_',' ')}</small><ul>{artifact.lines.map((line) => <li key={line}>{line}</li>)}</ul></div>)}</div>}
    <div className="audit-note">The desktop reads audit/evidence only from the OPTRANE Lovable gateway. Downstream Google, governance-provider and ClickHouse calls are server-side and return normalized evidence here.</div>
  </section>;
}
