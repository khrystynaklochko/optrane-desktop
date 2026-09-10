import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api/client';
import { demoAudit } from './api/mock';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAnalysisEvents } from './hooks/useAnalysisEvents';
import { useDeepLinks } from './hooks/useDeepLinks';
import { useKeyboardCommands } from './hooks/useKeyboardCommands';
import { useNotifications } from './hooks/useNotifications';
import { useNativeMenu } from './hooks/useNativeMenu';
import { cache } from './utils/cache';
import { AuditPage } from './pages/AuditPage';
import { ChangeReviewPage } from './pages/ChangeReviewPage';
import { ControlRoomPage } from './pages/ControlRoomPage';
import { GraphPage } from './pages/GraphPage';
import { ImpactPage } from './pages/ImpactPage';
import { NewProductionPage } from './pages/NewProductionPage';
import { RecoveryPage } from './pages/RecoveryPage';
import { ScriptRevisionPage } from './pages/ScriptRevisionPage';
import { AgentsPage } from './pages/AgentsPage';
import { AgentRegisterPage } from './pages/AgentRegisterPage';
import { AgentDetailPage } from './pages/AgentDetailPage';
import { AgentRunsPage } from './pages/AgentRunsPage';
import { ResearchPage } from './pages/ResearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { DemoRecordingPage } from './pages/DemoRecordingPage';
import { LoginPage } from './pages/LoginPage';
import { OptraneStateProvider, useOptraneState } from './state/OptraneState';
import { AuthStateProvider, useAuthState } from './state/AuthState';
import { isRecordingTestUser } from './config/demoRecording';
import type { AnalysisEvent, Screen } from './types/optrane';
import './styles.css';

function OptraneApplication() {
  const state = useOptraneState();
  const auth = useAuthState();
  const [toast, setToast] = useState('');
  const notify = useNotifications();
  const showToast = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(''), 4500); }, []);

  const refreshProduction = useCallback(async () => {
    try {
      let productionId = state.activeProductionId;
      if (!productionId || ['bootstrap','nightfall-demo'].includes(productionId)) {
        const productions = await api.listProductions();
        if (productions.length) {
          productionId = productions[0].productionId;
          state.setActiveProductionId(productionId);
          localStorage.setItem('optrane.activeProductionId', productionId);
        }
      }
      if (!productionId || ['bootstrap','nightfall-demo'].includes(productionId)) throw new ApiError(404, 'No OPTRANE production exists for this account yet.', '/productions');
      const [dashboard, audit] = await Promise.all([api.getDashboard(productionId), api.getAudit(productionId)]);
      state.setProduction({ ...dashboard, offlineSnapshot: false });
      state.setActiveRevisionVersion(dashboard.currentScriptVersion);
      state.setAudit(audit.events);
      cache.saveProduction(dashboard);
      cache.saveAudit(audit.events);
      state.setOffline(false);
    } catch (error) {
      const autoDemo = (import.meta.env.VITE_OPTRANE_AUTO_DEMO ?? 'false') === 'true';
      if (autoDemo && error instanceof ApiError && error.status === 404) {
        try {
          const result = await api.resetDemo();
          state.setActiveProductionId(result.productionId);
          localStorage.setItem('optrane.activeProductionId', result.productionId);
          state.setProduction(result.dashboard);
          state.setActiveRevisionVersion(result.dashboard.currentScriptVersion);
          state.setAudit((await api.getAudit(result.productionId)).events);
          state.setOffline(false);
          return;
        } catch { /* continue into offline fallback */ }
      }
      if (error instanceof ApiError && error.status === 404) {
        state.setOffline(false);
        if (isRecordingTestUser(auth.user?.email)) {
          try {
            const result = await api.prepareRecordingDemo();
            state.setActiveProductionId(result.productionId);
            localStorage.setItem('optrane.activeProductionId', result.productionId);
            state.setProduction(result.dashboard);
            state.setActiveRevisionVersion(result.dashboard.currentScriptVersion);
            state.setAudit((await api.getAudit(result.productionId)).events);
            state.setScreen('demo-recording');
            showToast('Test account verified. NIGHTFALL 94% baseline is prebuilt and ready.');
            return;
          } catch {
            state.setScreen('demo-recording');
            showToast('Test account verified. Open Recording Workflow to prepare NIGHTFALL.');
          }
        } else {
          state.setScreen('new-production');
          showToast('Your account is verified. Create your first production to begin.');
        }
        return;
      }
      state.setOffline(true);
      if (!state.audit.length) state.setAudit(cache.loadAudit() ?? demoAudit);
      showToast('OPTRANE gateway unavailable — showing the last local production snapshot.');
    }
  }, [state.activeProductionId, state.setActiveProductionId, state.setScreen, state.setProduction, state.setActiveRevisionVersion, state.setAudit, state.setOffline, state.audit.length, showToast, auth.user?.email]);

  useEffect(() => { localStorage.setItem('optrane.activeProductionId', state.activeProductionId); }, [state.activeProductionId]);
  useEffect(() => { void refreshProduction(); }, [refreshProduction]);
  useEffect(() => {
    if (!isRecordingTestUser(auth.user?.email)) return;
    const key = 'optrane.recordingModeOpened.v052';
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    state.setScreen('demo-recording');
  }, [auth.user?.email, state.setScreen]);

  const handleAnalysisEvent = useCallback((event: AnalysisEvent) => {
    state.setAnalysisEvents((items) => items.some((item) => item.id === event.id) ? items : [...items, event]);
  }, [state.setAnalysisEvents]);

  const handleAnalysisTerminal = useCallback(async (event: AnalysisEvent) => {
    if (!state.activeAnalysisId) return;
    if (event.type === 'ANALYSIS_FAILED') {
      await notify('OPTRANE analysis failed', event.message);
      showToast('Analysis failed. No production state was changed.');
      return;
    }
    try {
      const [analysis, plans, audit] = await Promise.all([
        api.getAnalysis(state.activeProductionId, state.activeAnalysisId),
        api.getRecoveryPlans(state.activeProductionId, state.activeAnalysisId),
        api.getAudit(state.activeProductionId)
      ]);
      state.setChanges(analysis.changes);
      state.setImpacts(analysis.impacts);
      state.setReadinessBefore(analysis.readinessBefore);
      state.setReadinessAfter(analysis.readinessAfter);
      state.setPlans(plans.plans);
      state.setAudit(audit.events);
      cache.saveAnalysis(analysis);
      cache.saveAudit(audit.events);
      const urgent = analysis.impacts.filter((finding) => finding.severity === 'CRITICAL' || finding.severity === 'HIGH').length;
      if (urgent > 0) await notify('OPTRANE impact analysis complete', `${urgent} critical/high findings require production review.`);
    } catch (error) { showToast(error instanceof Error ? error.message : 'Could not load completed analysis'); }
  }, [state.activeAnalysisId, state.activeProductionId, state.setChanges, state.setImpacts, state.setReadinessBefore, state.setReadinessAfter, state.setPlans, state.setAudit, notify, showToast]);

  const handleConnection = useCallback((connection: Parameters<typeof state.setConnectionState>[0]) => state.setConnectionState(connection), [state.setConnectionState]);
  useAnalysisEvents({
    url: state.activeAnalysisId ? api.eventUrl(state.activeProductionId, state.activeAnalysisId) : null,
    enabled: !!state.activeAnalysisId && !['COMPLETE','FAILED'].includes(state.connectionState),
    onEvent: handleAnalysisEvent,
    onTerminal: handleAnalysisTerminal,
    onConnection: handleConnection
  });

  const resetDemo = useCallback(() => {
    void api.resetDemo().then((result) => {
      state.resetClientDemo();
      state.setProduction(result.dashboard);
      state.setActiveProductionId(result.productionId);
      return api.getAudit(result.productionId);
    }).then((audit) => state.setAudit(audit.events)).catch(() => {
      state.resetClientDemo();
      showToast('Backend reset unavailable; client demo snapshot restored instead.');
    });
  }, [state.resetClientDemo, state.setProduction, state.setActiveProductionId, state.setAudit, showToast]);
  useKeyboardCommands(state.setScreen, resetDemo);
  useNativeMenu(state.setScreen, resetDemo);

  const handleDeepLink = useCallback((screen: Screen, productionId?: string, analysisId?: string, agentId?: string) => {
    if (productionId) state.setActiveProductionId(productionId);
    if (analysisId) { state.setActiveAnalysisId(analysisId); state.setConnectionState('CONNECTING'); }
    if (agentId) state.setActiveAgentId(agentId);
    state.setScreen(screen);
  }, [state.setActiveProductionId, state.setActiveAnalysisId, state.setActiveAgentId, state.setConnectionState, state.setScreen]);
  useDeepLinks(handleDeepLink);

  const page = (() => {
    switch (state.screen) {
      case 'control': return <ControlRoomPage/>;
      case 'new-production': return <NewProductionPage onToast={showToast}/>;
      case 'revision': return <ScriptRevisionPage onToast={showToast}/>;
      case 'change-review': return <ChangeReviewPage onToast={showToast}/>;
      case 'impact': return <ImpactPage/>;
      case 'research': return <ResearchPage onToast={showToast}/>;
      case 'recovery': return <RecoveryPage onToast={showToast}/>;
      case 'graph': return <GraphPage onToast={showToast}/>;
      case 'audit': return <AuditPage/>;
      case 'agents': return <AgentsPage onToast={showToast}/>;
      case 'agent-register': return <AgentRegisterPage onToast={showToast}/>;
      case 'agent-detail': return <AgentDetailPage onToast={showToast}/>;
      case 'agent-runs': return <AgentRunsPage onToast={showToast}/>;
      case 'settings': return <SettingsPage onToast={showToast}/>;
      case 'demo-recording': return <DemoRecordingPage onToast={showToast}/>;
    }
  })();

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">O</div><div><b>OPTRANE</b><small>Autonomous Operations</small></div></div>
      <nav>
        {isRecordingTestUser(auth.user?.email) && <><span className="nav-section">DEMO</span><button className={state.screen === 'demo-recording' ? 'active demo-nav' : 'demo-nav'} onClick={() => state.setScreen('demo-recording')}>Recording Workflow <span className="nav-demo">REC</span></button></>}
        <span className="nav-section">PRODUCTION</span>
        <button className={state.screen === 'control' ? 'active' : ''} onClick={() => state.setScreen('control')}>Control Room <kbd>⌘1</kbd></button>
        <button className={state.screen === 'new-production' ? 'active' : ''} onClick={() => state.setScreen('new-production')}>New Production <kbd>⌘N</kbd></button>
        <button className={['revision','change-review'].includes(state.screen) ? 'active' : ''} onClick={() => state.setScreen('revision')}>Script Revision <kbd>⌘O</kbd></button>
        <button className={state.screen === 'impact' ? 'active' : ''} onClick={() => state.setScreen('impact')}>Impact <kbd>⌘2</kbd></button>
        <button className={state.screen === 'research' ? 'active' : ''} onClick={() => state.setScreen('research')}>Location Scout</button>
        <button className={state.screen === 'recovery' ? 'active' : ''} onClick={() => state.setScreen('recovery')}>Recovery <kbd>⌘3</kbd></button>
        <button className={state.screen === 'graph' ? 'active' : ''} onClick={() => state.setScreen('graph')}>Dependency Graph</button>
        <span className="nav-section">AGENTS</span>
        <button className={['agents','agent-register','agent-detail','agent-runs'].includes(state.screen) ? 'active' : ''} onClick={() => state.setScreen('agents')}>Agent Fleet <span className="nav-ac">AC</span></button>
        <span className="nav-section">SYSTEM</span>
        <button className={state.screen === 'audit' ? 'active' : ''} onClick={() => state.setScreen('audit')}>Audit Trail</button>
        <button className={state.screen === 'settings' ? 'active' : ''} onClick={() => state.setScreen('settings')}>Settings</button>
      </nav>
      <div className="sidebar-tools">{isRecordingTestUser(auth.user?.email) && <button className="link-button" onClick={() => state.setScreen('demo-recording')}>Open recording workflow</button>}<button className="link-button" onClick={resetDemo}>Reset NIGHTFALL demo</button></div>
      <div className="sidebar-foot">
        <span className={`status-dot ${state.offline ? 'offline' : ''}`} /> {state.offline ? 'Offline snapshot' : 'Lovable backend connected'}
        <small>{auth.user?.email ?? 'Anonymous session'}</small>
        <button type="button" className="link-button disconnect-button" onClick={() => void auth.signOut().catch((error) => showToast(error instanceof Error ? error.message : 'Could not disconnect'))}>Disconnect</button>
      </div>
    </aside>
    <main>
      <header className="topbar"><div><span className="eyebrow">ACTIVE PRODUCTION</span><strong>{state.production.title}</strong></div><div className="top-actions"><span>Script v{state.production.currentScriptVersion}</span>{state.connectionState !== 'DISCONNECTED' && <span className={`connection connection-${state.connectionState.toLowerCase()}`}>{state.connectionState}</span>}<button className="ghost" onClick={() => state.setScreen('agents')}>Agents</button><button className="primary compact-button" onClick={() => state.setScreen('revision')}>Analyse revision</button></div></header>
      {toast && <div className="toast" onClick={() => setToast('')}>{toast}</div>}
      {page}
    </main>
  </div>;
}

function AuthGate() {
  const auth = useAuthState();
  if (!auth.ready) return <div className="boot-screen"><div className="brand-mark large">O</div><b>OPTRANE</b><span>Opening secure production workspace…</span></div>;
  if (!auth.session) return <LoginPage/>;
  return <OptraneStateProvider><OptraneApplication/></OptraneStateProvider>;
}

export default function App() {
  return <ErrorBoundary><AuthStateProvider><AuthGate/></AuthStateProvider></ErrorBoundary>;
}
