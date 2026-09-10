import { Metric } from '../components/Metric';
import { useOptraneState } from '../state/OptraneState';

export function ControlRoomPage() {
  const { production, audit, setScreen, offline } = useOptraneState();
  const risks = production.riskCounts ?? {};
  return <section className="page">
    {offline && <div className="offline-banner">Offline snapshot · last known production state</div>}
    <div className="hero-grid">
      <div className="readiness-card"><span className="eyebrow">PRODUCTION READY</span><div className="readiness">{production.readiness}<sup>%</sup></div><p>{production.shootDayLabel}</p><div className="progress"><i style={{ width: `${production.readiness}%` }} /></div></div>
      <div className="risk-stack"><div className="risk critical"><b>{risks.CRITICAL ?? 0}</b><span>CRITICAL</span></div><div className="risk high"><b>{risks.HIGH ?? 0}</b><span>HIGH</span></div><div className="risk watch"><b>{risks.WATCH ?? 0}</b><span>WATCH</span></div></div>
    </div>
    <div className="metrics"><Metric value={production.scenes} label="Scenes"/><Metric value={production.crew} label="Crew"/><Metric value={production.cast} label="Cast"/><Metric value={production.locations} label="Locations"/><Metric value={`$${Math.round(production.plannedCost/1000)}K`} label="Planned"/></div>
    <div className="two-col">
      <div className="panel"><div className="panel-head"><div><span className="eyebrow">RECENT SIGNALS</span><h2>Production pulse</h2></div><button className="link-button" onClick={() => setScreen('audit')}>Full audit →</button></div>{audit.slice(-5).reverse().map((e) => <div className="activity" key={e.id}><time>{e.time}</time><div><b>{e.summary}</b><span>{e.actor} · {e.source ?? 'OPTRANE'}</span></div></div>)}</div>
      <div className="panel highlight"><span className="eyebrow">NEXT ACTION</span><h2>New screenplay revision?</h2><p>Compare it against the production graph before it becomes tomorrow’s delay.</p><button className="primary" onClick={() => setScreen('revision')}>Analyse New Revision →</button><button className="ghost subtle" onClick={() => setScreen('new-production')}>Create another production</button></div>
    </div>
  </section>;
}
