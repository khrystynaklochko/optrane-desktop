import { useMemo, useState } from 'react';
import { api } from '../api/client';
import { capabilityCatalog, dataClassCatalog, templateFor, toolCatalog } from '../agents/templates';
import { useOptraneState } from '../state/OptraneState';
import type { AgentDataClass, AgentTool, AgentType, DataAccess, ProductionAgent, RegisterAgentInput } from '../types/optrane';

const types: AgentType[] = ['DIRECTOR','BREAKDOWN','REVISION','IMPACT','RECOVERY','SCHEDULE','RISK','CUSTOM'];

export function AgentRegisterPage({ onToast }: { onToast: (message: string) => void }) {
  const state = useOptraneState();
  const [draft, setDraft] = useState<RegisterAgentInput>(() => templateFor('IMPACT'));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProductionAgent | null>(null);

  const selectedCapabilities = useMemo(() => new Set(draft.capabilities), [draft.capabilities]);
  const selectedTools = useMemo(() => new Set(draft.tools.map((tool) => tool.toolKey)), [draft.tools]);

  const applyType = (agentType: AgentType) => setDraft(templateFor(agentType));
  const toggleCapability = (value: string) => setDraft((current) => ({ ...current, capabilities: selectedCapabilities.has(value) ? current.capabilities.filter((v) => v !== value) : [...current.capabilities, value] }));
  const toggleTool = (tool: AgentTool) => setDraft((current) => ({ ...current, tools: selectedTools.has(tool.toolKey) ? current.tools.filter((v) => v.toolKey !== tool.toolKey) : [...current.tools, tool] }));
  const setDataAccess = (dataClass: string, access: DataAccess) => setDraft((current) => ({ ...current, dataClasses: current.dataClasses.map((item): AgentDataClass => item.dataClass === dataClass ? { ...item, access } : item) }));

  const register = async () => {
    if (!draft.name.trim() || !draft.purpose.trim()) { onToast('Name and purpose are required.'); return; }
    if (!draft.capabilities.length) { onToast('Choose at least one capability.'); return; }
    if (draft.selfImprovement.enabled && (draft.selfImprovement.budget.perIteration > draft.selfImprovement.budget.daily || draft.selfImprovement.budget.maxIterationsPerRun < 1)) {
      onToast('Self-improvement per-iteration cap must fit inside the daily cap, with at least one iteration per run.'); return;
    }
    setBusy(true);
    try {
      const agent = await api.registerAgent(state.activeProductionId, draft);
      setResult(agent);
      state.setActiveAgentId(agent.id);
      onToast(agent.governance?.passportId ? 'Agent registered and governance passport issued.' : 'Agent created; governance provisioning is still pending.');
    } catch (error) { onToast(error instanceof Error ? error.message : 'Agent registration failed'); }
    finally { setBusy(false); }
  };

  if (result) return <section className="page">
    <div className="success-passport panel">
      <div className="passport-check">✓</div><span className="eyebrow">AGENT REGISTERED</span><h1>{result.name}</h1><p>{result.purpose}</p>
      <div className="passport-result-grid">
        <div><span>GOVERNANCE PASSPORT</span><strong>{result.governance?.passportId ?? 'Provisioning'}</strong></div>
        <div><span>STATUS</span><strong>{result.governance?.trustStatus ?? result.status}</strong></div>
        <div><span>TRUST SCORE</span><strong>{result.governance?.trustScore ?? '—'}</strong></div>
        <div><span>RUN BUDGET</span><strong>${result.budget?.perRun ?? draft.budget.perRun} / run</strong></div>
        <div><span>IMPROVEMENT CAP</span><strong>${result.selfImprovement?.budget.perIteration ?? draft.selfImprovement.budget.perIteration} / iteration</strong></div>
      </div>
      <div className="human-gate"><b>Self-improvement is bounded</b><span>{result.selfImprovement?.rule ?? draft.selfImprovement.rule}</span></div>
      <div className="button-row"><button className="primary" onClick={() => state.setScreen('agent-detail')}>View agent</button><button className="ghost" onClick={() => { setResult(null); setDraft(templateFor('IMPACT')); }}>Register another</button></div>
    </div>
  </section>;

  return <section className="page register-agent-page">
    <div className="page-head"><div><span className="eyebrow">NEW GOVERNED IDENTITY</span><h1>Register Governed Agent</h1><p>The desktop submits an OPTRANE agent specification only. Identity provisioning, peer authentication, policies and provider API calls happen entirely on the Lovable backend.</p></div><button className="ghost" onClick={() => state.setScreen('agents')}>Cancel</button></div>

    <div className="register-layout">
      <div className="register-main">
        <div className="panel form-section"><div className="section-number">01</div><div className="section-title"><h3>Identity</h3><span>Name, runtime and narrow operational purpose.</span></div>
          <div className="form-grid"><label>Agent type<select value={draft.agentType} onChange={(e) => applyType(e.target.value as AgentType)}>{types.map((type) => <option key={type} value={type}>{type}</option>)}</select></label><label>Name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}/></label><label>Runtime<input value={draft.runtime} disabled/></label><label>Model<input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })}/></label></div>
          <label className="field-label">Purpose<textarea rows={4} value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}/></label>
        </div>

        <div className="panel form-section"><div className="section-number">02</div><div className="section-title"><h3>Capabilities</h3><span>Declared abilities; unknown capabilities are denied server-side.</span></div>
          <div className="choice-grid">{capabilityCatalog.map((capability) => <label key={capability} className={`choice-card ${selectedCapabilities.has(capability) ? 'checked' : ''}`}><input type="checkbox" checked={selectedCapabilities.has(capability)} onChange={() => toggleCapability(capability)}/><span>{capability.replaceAll('_',' ')}</span></label>)}</div>
        </div>

        <div className="panel form-section"><div className="section-number">03</div><div className="section-title"><h3>Tools</h3><span>Agents receive READ or PROPOSE access. Direct production mutation remains approval-gated.</span></div>
          <div className="tool-list">{toolCatalog.map((tool) => <label key={tool.toolKey} className={`tool-choice ${selectedTools.has(tool.toolKey) ? 'checked' : ''}`}><input type="checkbox" checked={selectedTools.has(tool.toolKey)} onChange={() => toggleTool(tool)}/><div><b>{tool.toolKey}</b><small>{tool.provider}</small></div><span>{tool.accessMode}</span></label>)}</div>
        </div>

        <div className="panel form-section"><div className="section-number">04</div><div className="section-title"><h3>Data clearance</h3><span>OPTRANE submits only the requested classes; the backend governance layer remains authoritative.</span></div>
          <div className="data-access-table">{dataClassCatalog.map((name) => { const item = draft.dataClasses.find((v) => v.dataClass === name)!; return <div key={name}><b>{name.replaceAll('_',' ')}</b><select value={item.access} onChange={(e) => setDataAccess(name, e.target.value as DataAccess)}><option value="ALLOWED">Allow</option><option value="CONDITIONAL">Conditional</option><option value="DENIED">Deny</option></select></div>; })}</div>
        </div>

        <div className="panel form-section self-improvement-section"><div className="section-number">05</div><div className="section-title"><h3>Self-improvement rule</h3><span>Gemini can improve strategy, but not its authority.</span></div>
          <label className="toggle-row"><input type="checkbox" checked={draft.selfImprovement.enabled} onChange={(e) => setDraft({ ...draft, selfImprovement: { ...draft.selfImprovement, enabled: e.target.checked } })}/><div><b>Enable bounded self-improvement</b><small>Creates candidates only. Human approval is required before a candidate becomes the next strategy version.</small></div></label>
          <div className="improvement-rule-card"><span>RULE SHOWN TO THE AGENT</span><p>{draft.selfImprovement.rule}</p><div className="rule-split"><div><b>May improve</b><small>{draft.selfImprovement.allowed.map((x) => x.replaceAll('_',' ')).join(' · ')}</small></div><div><b>Cannot change</b><small>Tools · permissions · data access · model · code · governance policy · budgets · secrets</small></div></div></div>
          <div className="form-grid"><label>Per improvement iteration ($)<input type="number" min="0" max="5" step="0.05" value={draft.selfImprovement.budget.perIteration} onChange={(e) => setDraft({ ...draft, selfImprovement: { ...draft.selfImprovement, budget: { ...draft.selfImprovement.budget, perIteration: Number(e.target.value) } } })}/></label><label>Improvement daily cap ($)<input type="number" min="0" max="50" step="0.25" value={draft.selfImprovement.budget.daily} onChange={(e) => setDraft({ ...draft, selfImprovement: { ...draft.selfImprovement, budget: { ...draft.selfImprovement.budget, daily: Number(e.target.value) } } })}/></label><label>Max iterations / run<input type="number" min="1" max="10" step="1" value={draft.selfImprovement.budget.maxIterationsPerRun} onChange={(e) => setDraft({ ...draft, selfImprovement: { ...draft.selfImprovement, budget: { ...draft.selfImprovement.budget, maxIterationsPerRun: Number(e.target.value) } } })}/></label><label>Max iterations / day<input type="number" min="1" max="100" step="1" value={draft.selfImprovement.budget.maxDailyIterations ?? 10} onChange={(e) => setDraft({ ...draft, selfImprovement: { ...draft.selfImprovement, budget: { ...draft.selfImprovement.budget, maxDailyIterations: Number(e.target.value) } } })}/></label></div>
        </div>
      </div>

      <aside className="register-side">
        <div className="panel sticky-card"><span className="eyebrow">GOVERNANCE PASSPORT</span><div className="passport-preview"><div className="preview-id">AI</div><h2>{draft.name || 'Unnamed Agent'}</h2><span>{draft.agentType}</span><div className="preview-line"><small>Runtime</small><b>{draft.runtime}</b></div><div className="preview-line"><small>Capabilities</small><b>{draft.capabilities.length}</b></div><div className="preview-line"><small>Tools</small><b>{draft.tools.length}</b></div></div>
          <h4>Execution budget</h4><label className="budget-field">Per run <div><span>$</span><input type="number" min="0" step="0.1" value={draft.budget.perRun} onChange={(e) => setDraft({ ...draft, budget: { ...draft.budget, perRun: Number(e.target.value) } })}/></div></label><label className="budget-field">Daily <div><span>$</span><input type="number" min="0" step="1" value={draft.budget.daily} onChange={(e) => setDraft({ ...draft, budget: { ...draft.budget, daily: Number(e.target.value) } })}/></div></label>
          <h4>Improvement budget</h4><div className="budget-row"><span>Per iteration</span><b>${draft.selfImprovement.budget.perIteration}</b></div><div className="budget-row"><span>Daily cap</span><b>${draft.selfImprovement.budget.daily}</b></div><div className="budget-row"><span>Iterations / run</span><b>{draft.selfImprovement.budget.maxIterationsPerRun}</b></div>
          <div className="guardrail-note"><b>Hard server guardrail</b><span>Secrets denied · unknown tools denied · ClickHouse MCP read only · self-improvement cannot change authority or increase budgets · promotion requires a human.</span></div>
          <button className="primary wide" disabled={busy} onClick={() => void register()}>{busy ? 'Provisioning governed identity…' : 'Register agent'}</button>
        </div>
      </aside>
    </div>
  </section>;
}
