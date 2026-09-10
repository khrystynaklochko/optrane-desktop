import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useOptraneState } from '../state/OptraneState';
import { cache } from '../utils/cache';
import type { ResearchBrief } from '../types/optrane';

const STAGES = [
  'Planning Gemini research queries…',
  'Searching the web with Parallel…',
  'Grading location and clearance risks…',
];

function severityClass(severity: string) {
  const value = severity.toLowerCase();
  if (value === 'critical') return 'research-risk critical';
  if (value === 'high') return 'research-risk high';
  if (value === 'medium') return 'research-risk medium';
  return 'research-risk low';
}

export function ResearchPage({ onToast }: { onToast: (message: string) => void }) {
  const state = useOptraneState();
  const [question, setQuestion] = useState(state.researchDraft?.question ?? '');
  const [context, setContext] = useState(state.researchDraft?.context ?? '');
  const [sceneNumber, setSceneNumber] = useState(state.researchDraft?.sceneNumber ?? '');
  const [busy, setBusy] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  const [history, setHistory] = useState<ResearchBrief[]>([]);

  useEffect(() => {
    if (state.researchDraft?.question) setQuestion(state.researchDraft.question);
    if (state.researchDraft?.context) setContext(state.researchDraft.context);
    if (state.researchDraft?.sceneNumber) setSceneNumber(state.researchDraft.sceneNumber);
  }, [state.researchDraft]);

  useEffect(() => {
    void api.listResearch(state.activeProductionId)
      .then((items) => {
        setHistory(items);
        cache.saveResearch(state.activeProductionId, items);
      })
      .catch(() => {
        const cached = cache.loadResearch(state.activeProductionId);
        if (cached?.length) setHistory(cached);
      });
  }, [state.activeProductionId, brief]);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => {
      setStageIndex((current) => (current + 1) % STAGES.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [busy]);

  const run = async () => {
    if (!question.trim()) {
      onToast('Enter a location or clearance question for the scout agent.');
      return;
    }
    setBusy(true);
    setStageIndex(0);
    setBrief(null);
    try {
      const result = await api.runResearch(state.activeProductionId, {
        question: question.trim(),
        context: context.trim() || undefined,
        sceneNumber: sceneNumber.trim() || undefined,
      });
      setBrief(result);
      cache.saveResearch(state.activeProductionId, [result, ...history.filter((item) => item.id !== result.id)].slice(0, 12));
      state.setResearchDraft(null);
      onToast('Location & Clearance Scout brief ready.');
    } catch (error) {
      const message = error instanceof ApiError
        ? error.message
        : error instanceof Error ? error.message : 'Research request failed';
      onToast(message);
    } finally {
      setBusy(false);
    }
  };

  return <section className="page">
    <div className="page-head">
      <div>
        <span className="eyebrow">GEMINI + PARALLEL AGENT</span>
        <h1>Location &amp; Clearance Scout</h1>
        <p>Ask a production question. Gemini plans the research queries; Parallel returns live web citations; the gateway grades risks before anything mutates schedule state.</p>
      </div>
    </div>

    <div className="research-layout">
      <div className="panel research-form-panel">
        <span className="eyebrow">NEW BRIEF</span>
        <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void run(); }}>
          <label htmlFor="research-scene">Scene number (optional)</label>
          <input id="research-scene" value={sceneNumber} onChange={(event) => setSceneNumber(event.target.value)} placeholder="14" disabled={busy}/>
          <label htmlFor="research-question">Question</label>
          <textarea id="research-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Scene 14 moved to a night exterior — what permits do we need?" rows={4} disabled={busy}/>
          <label htmlFor="research-context">Context (optional)</label>
          <textarea id="research-context" value={context} onChange={(event) => setContext(event.target.value)} placeholder="Impact finding, location notes, or script excerpt" rows={3} disabled={busy}/>
          <button type="submit" className="primary wide" disabled={busy || !question.trim()}>{busy ? 'Researching…' : 'Run Location Scout'}</button>
        </form>
        {busy && <div className="research-stage"><span className="spinner"/>{STAGES[stageIndex]}</div>}
      </div>

      <div className="panel research-result-panel">
        {!brief && !busy && <div className="empty-agent-panel"><div className="passport-ghost">LS</div><h2>No brief yet</h2><p>Prefill a question from Impact findings or ask about permits, locations, weather windows, or clearance requirements.</p></div>}
        {brief && <>
          <div className="research-meta">
            {brief.reasoningBackend && <span className="research-badge">{brief.reasoningBackend}</span>}
            {brief.parallelSearchId && <span className="research-badge parallel">Parallel · {brief.parallelSearchId}</span>}
            {brief.sceneNumber && <span className="research-badge">Scene {brief.sceneNumber}</span>}
          </div>
          <p className="research-summary">{brief.summary}</p>
          {!!brief.risks.length && <>
            <span className="eyebrow">GRADED RISKS</span>
            <div className="research-risk-list">{brief.risks.map((risk) => <article className={severityClass(risk.severity)} key={risk.id}><div><b>{risk.title}</b><small>{risk.severity.toUpperCase()}</small></div><p>{risk.detail ?? risk.mitigation}</p>{risk.mitigation && risk.detail && <small>Mitigation: {risk.mitigation}</small>}</article>)}</div>
          </>}
          {!!brief.sources.length && <>
            <span className="eyebrow">PARALLEL CITATIONS</span>
            <div className="research-source-list">{brief.sources.map((source) => <a key={source.id} className="research-source" href={source.url} target="_blank" rel="noreferrer"><b>{source.title}</b>{source.snippet && <span>{source.snippet}</span>}<small>{source.provider ?? 'Parallel web search'}</small></a>)}</div>
          </>}
        </>}
      </div>
    </div>

    {!!history.length && <div className="panel full-span"><span className="eyebrow">BRIEF HISTORY</span><div className="research-history">{history.slice(0, 8).map((item) => <button type="button" key={item.id} className="research-history-item" onClick={() => setBrief(item)}><b>{item.question}</b><small>{item.createdAt ? new Date(item.createdAt).toLocaleString() : 'Recent brief'}{item.parallelSearchId ? ` · ${item.parallelSearchId}` : ''}</small></button>)}</div></div>}
  </section>;
}
