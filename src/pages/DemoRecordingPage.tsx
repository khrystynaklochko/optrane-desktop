import { useEffect, useMemo, useState } from 'react';
import { defaultFleetTypes, templateFor } from '../agents/templates';
import { api } from '../api/client';
import { demoChanges } from '../api/mock';
import { RECORDING_TEST_EMAIL, isRecordingTestUser } from '../config/demoRecording';
import { useAuthState } from '../state/AuthState';
import { useOptraneState } from '../state/OptraneState';
import type { IntegrationHealth, ProductionAgent } from '../types/optrane';

type StepState = 'READY' | 'RUNNING' | 'DONE' | 'BLOCKED';

function statusLabel(value: StepState) {
  if (value === 'DONE') return '✓ READY';
  if (value === 'RUNNING') return '● RUNNING';
  if (value === 'BLOCKED') return '! BLOCKED';
  return '○ READY';
}

export function DemoRecordingPage({ onToast }: { onToast: (message: string) => void }) {
  const auth = useAuthState();
  const state = useOptraneState();
  const [busy, setBusy] = useState('');
  const [health, setHealth] = useState<IntegrationHealth | null>(null);
  const [agents, setAgents] = useState<ProductionAgent[]>([]);
  const [baselineState, setBaselineState] = useState<StepState>('READY');
  const [revisionState, setRevisionState] = useState<StepState>('READY');
  const [fleetState, setFleetState] = useState<StepState>('READY');
  const [cloudState, setCloudState] = useState<StepState>('READY');

  const isTestUser = isRecordingTestUser(auth.user?.email);
  const strictReady = !!health?.strictMode?.ready;
  const impactAgent = useMemo(() => agents.find((agent) => agent.agentType === 'IMPACT'), [agents]);

  const refreshHealth = async () => {
    setBusy('health');
    try {
      const next = await api.integrationHealth();
      setHealth(next);
      setCloudState(next.strictMode?.ready ? 'DONE' : 'BLOCKED');
      onToast(next.strictMode?.ready ? 'Cloud path ready for recording.' : 'Cloud path is not fully ready yet.');
    } catch (error) {
      setCloudState('BLOCKED');
      onToast(error instanceof Error ? error.message : 'Could not check integrations');
    } finally { setBusy(''); }
  };

  const refreshAgents = async (productionId = state.activeProductionId) => {
    if (!productionId || productionId === 'bootstrap') return [];
    try {
      const next = await api.listAgents(productionId);
      setAgents(next);
      if (defaultFleetTypes.every((type) => next.some((agent) => agent.agentType === type && agent.status === 'ACTIVE'))) setFleetState('DONE');
      return next;
    } catch { return []; }
  };

  useEffect(() => {
    if (!isTestUser) return;
    void refreshHealth();
    if (state.activeProductionId && state.activeProductionId !== 'bootstrap') void refreshAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTestUser]);

  useEffect(() => {
    if (state.production.title !== 'NIGHTFALL') return;
    if (state.production.currentScriptVersion >= 7) setBaselineState('DONE');
    if (state.production.currentScriptVersion >= 8) setRevisionState('DONE');
  }, [state.production.title, state.production.currentScriptVersion]);

  async function prepareBaseline() {
    setBusy('baseline'); setBaselineState('RUNNING');
    try {
      const result = await api.prepareRecordingDemo();
      state.resetClientDemo();
      state.setActiveProductionId(result.productionId);
      state.setProduction(result.dashboard);
      state.setActiveRevisionVersion(result.dashboard.currentScriptVersion);
      state.setChanges([]); state.setImpacts([]); state.setPlans([]); state.setActiveAnalysisId(null);
      const audit = await api.getAudit(result.productionId);
      state.setAudit(audit.events);
      setBaselineState('DONE'); setRevisionState('READY');
      await refreshAgents(result.productionId);
      onToast('NIGHTFALL baseline prepared at 94% for the recording account.');
    } catch (error) {
      setBaselineState('BLOCKED');
      onToast(error instanceof Error ? error.message : 'Could not prepare recording demo');
    } finally { setBusy(''); }
  }

  async function stageRevision() {
    setBusy('revision'); setRevisionState('RUNNING');
    try {
      const result = await api.loadRecordingRevision();
      state.setActiveProductionId(result.productionId);
      state.setActiveRevisionVersion(result.version);
      state.setProduction(result.dashboard);
      state.setChanges(result.changes?.length ? result.changes : demoChanges);
      state.setScreen('change-review');
      setRevisionState('DONE');
      onToast('NIGHTFALL v8 staged: child performer, drone, vehicle stunt and rain effect.');
    } catch (error) {
      setRevisionState('BLOCKED');
      onToast(error instanceof Error ? error.message : 'Could not stage demo revision');
    } finally { setBusy(''); }
  }

  async function provisionFleet() {
    setBusy('fleet'); setFleetState('RUNNING');
    try {
      const existing = await refreshAgents();
      const missing = defaultFleetTypes.filter((type) => !existing.some((agent) => agent.agentType === type && agent.status !== 'REVOKED'));
      if (missing.length) {
        await api.registerFleet(state.activeProductionId, {
          agentTypes: missing,
          agent_types: missing,
          templates: missing.map((type) => templateFor(type)),
        });
      }
      const after = await refreshAgents();
      const ready = defaultFleetTypes.every((type) => after.some((agent) => agent.agentType === type && agent.status === 'ACTIVE'));
      setFleetState(ready ? 'DONE' : 'BLOCKED');
      onToast(ready ? 'Governed production crew ready.' : 'Some agents still require governance attention.');
    } catch (error) {
      setFleetState('BLOCKED');
      onToast(error instanceof Error ? error.message : 'Could not provision governed fleet');
    } finally { setBusy(''); }
  }

  async function runLiveAnalysis() {
    setBusy('analysis');
    try {
      const nextHealth = await api.integrationHealth();
      setHealth(nextHealth);
      if (nextHealth.strictMode && !nextHealth.strictMode.ready) {
        setCloudState('BLOCKED');
        onToast('Strict Google Agent Runtime + ClickHouse MCP path is not ready.');
        state.setScreen('settings');
        return;
      }
      setCloudState('DONE');
      state.setAnalysisEvents([]); state.setImpacts([]); state.setPlans([]);
      const started = await api.startAnalysis(state.activeProductionId, state.activeRevisionVersion);
      state.setActiveAnalysisId(started.analysisId);
      state.setConnectionState('CONNECTING');
      state.setScreen('impact');
      onToast('Live analysis started. Keep the execution timeline visible for the recording.');
    } catch (error) { onToast(error instanceof Error ? error.message : 'Could not start live analysis'); }
    finally { setBusy(''); }
  }

  async function openImpactAgent() {
    setBusy('agent');
    try {
      const current = agents.length ? agents : await refreshAgents();
      const agent = current.find((item) => item.agentType === 'IMPACT');
      if (!agent) throw new Error('Impact Agent is not registered yet. Provision the governed crew first.');
      state.setActiveAgentId(agent.id);
      state.setScreen('agent-detail');
    } catch (error) { onToast(error instanceof Error ? error.message : 'Could not open Impact Agent'); }
    finally { setBusy(''); }
  }

  if (!isTestUser) return <section className="page narrow"><span className="eyebrow">RECORDING MODE</span><h1>Demo workflow restricted</h1><p className="lede">This prebuilt recording workflow is available only to the configured OPTRANE test account.</p><div className="panel"><b>Configured test user</b><p>{RECORDING_TEST_EMAIL}</p></div></section>;

  return <section className="page demo-recording-page">
    <div className="page-head"><div><span className="eyebrow">PREBUILT RECORDING WORKFLOW</span><h1>Record the NIGHTFALL demo without setup drift.</h1><p>Signed in as <b>{auth.user?.email}</b>. Preparation is deterministic; Google Agent Runtime, Gemini and ClickHouse MCP execution stays live.</p></div><div className="recording-badge">TEST ACCOUNT · READY TO STAGE</div></div>

    <div className="recording-overview panel">
      <div><span>BASELINE</span><strong>94%</strong><small>NIGHTFALL · 8 scenes · 26 crew · 6 cast · 2 locations</small></div>
      <i>→</i><div><span>REVISION</span><strong>4</strong><small>minor · drone · stunt · rain</small></div>
      <i>→</i><div><span>LIVE IMPACT</span><strong>68%</strong><small>Google ADK → MCP run_query → ClickHouse evidence</small></div>
      <i>→</i><div><span>RECOVERY</span><strong>91%</strong><small>approve Plan B</small></div>
    </div>

    <div className="recording-grid">
      <div className="panel recording-step"><div className="recording-step-head"><span>01</span><div><b>Prepare NIGHTFALL baseline</b><small>Deletes only this test account's previous demo fixture and restores v7 at 94%.</small></div><strong className={baselineState.toLowerCase()}>{statusLabel(baselineState)}</strong></div><button className="primary wide" disabled={!!busy} onClick={() => void prepareBaseline()}>{busy === 'baseline' ? 'Preparing…' : 'Prepare 94% baseline'}</button></div>

      <div className="panel recording-step"><div className="recording-step-head"><span>02</span><div><b>Check competition cloud path</b><small>Google Agent Runtime / ADK, Gemini, ClickHouse and official MCP must be ready.</small></div><strong className={cloudState.toLowerCase()}>{statusLabel(cloudState)}</strong></div><div className="mini-health"><span>Agent Runtime</span><b>{health?.agentRuntime?.reachable ? 'ONLINE' : '—'}</b><span>Gemini</span><b>{health?.gemini?.model ?? '—'}</b><span>ClickHouse MCP</span><b>{health?.mcp?.reachable ? `${health.mcp.tool ?? 'run_query'} · READ ONLY` : '—'}</b></div><button className="ghost wide" disabled={!!busy} onClick={() => void refreshHealth()}>{busy === 'health' ? 'Checking…' : 'Run preflight'}</button></div>

      <div className="panel recording-step"><div className="recording-step-head"><span>03</span><div><b>Provision governed AI crew</b><small>Director, Breakdown, Revision, Impact and Recovery agents with bounded self-improvement.</small></div><strong className={fleetState.toLowerCase()}>{statusLabel(fleetState)}</strong></div><button className="ghost wide" disabled={!!busy || baselineState !== 'DONE'} onClick={() => void provisionFleet()}>{busy === 'fleet' ? 'Provisioning…' : 'Initialize governed crew'}</button></div>

      <div className="panel recording-step"><div className="recording-step-head"><span>04</span><div><b>Stage screenplay revision v8</b><small>Loads the four material Scene 42 changes and takes you directly to Change Review.</small></div><strong className={revisionState.toLowerCase()}>{statusLabel(revisionState)}</strong></div><button className="primary wide" disabled={!!busy || baselineState !== 'DONE'} onClick={() => void stageRevision()}>{busy === 'revision' ? 'Staging…' : 'Stage four material changes'}</button></div>

      <div className="panel recording-step featured"><div className="recording-step-head"><span>05</span><div><b>Run the live evidence analysis</b><small>This is the part to record live: Google ADK must call official ClickHouse MCP <code>run_query</code>.</small></div><strong className={strictReady ? 'done' : 'ready'}>{strictReady ? '✓ LIVE PATH READY' : '○ PREFLIGHT FIRST'}</strong></div><button className="primary wide" disabled={!!busy || state.activeRevisionVersion < 8 || !strictReady} onClick={() => void runLiveAnalysis()}>{busy === 'analysis' ? 'Starting…' : 'Analyse live →'}</button></div>

      <div className="panel recording-step"><div className="recording-step-head"><span>06</span><div><b>Show bounded self-improvement</b><small>Open the Impact Agent policy: strategy can improve; authority, tools, model and budgets cannot.</small></div><strong className={impactAgent ? 'done' : 'ready'}>{impactAgent ? '✓ IMPACT AGENT' : '○ PROVISION FLEET'}</strong></div><button className="ghost wide" disabled={!!busy || !impactAgent} onClick={() => void openImpactAgent()}>{busy === 'agent' ? 'Opening…' : 'Open self-improvement policy'}</button></div>
    </div>

    <div className="panel recording-script">
      <div className="panel-head"><div><span className="eyebrow">RECORDING ORDER</span><h2>Three-minute path</h2></div><span className="count-pill">8 beats</span></div>
      <ol>
        <li><b>Website verification</b><span>Show {RECORDING_TEST_EMAIL} as verified and approve OPTRANE Command.</span></li>
        <li><b>Control Room</b><span>NIGHTFALL · 94% ready.</span></li>
        <li><b>Revision</b><span>Stage child performer, drone, vehicle stunt and artificial rain.</span></li>
        <li><b>Live execution</b><span>Keep Google Agent Runtime → ADK → ClickHouse MCP run_query visible.</span></li>
        <li><b>Blast radius</b><span>Reveal 68% and open one MCP-backed evidence item.</span></li>
        <li><b>Recovery</b><span>Compare A/B/C and approve Plan B.</span></li>
        <li><b>Self-improvement</b><span>Show rule + $0.25/iteration · $2/day · 2 iterations/run.</span></li>
        <li><b>Audit</b><span>Finish on 91% readiness and the immutable evidence trail.</span></li>
      </ol>
      <div className="button-row"><button className="ghost" onClick={() => state.setScreen('control')}>Open Control Room</button><button className="ghost" onClick={() => state.setScreen('recovery')}>Open Recovery</button><button className="ghost" onClick={() => state.setScreen('audit')}>Open Audit</button></div>
    </div>
  </section>;
}
