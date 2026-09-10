import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { demoAudit, demoChanges, demoImpacts, demoPlans, demoProduction } from '../api/mock';
import { cache } from '../utils/cache';
import type {
  AnalysisEvent, ArtifactDelta, AuditEvent, ConnectionState, GraphResponse, ImpactFinding,
  ProductionSummary, RecoveryPlan, ResearchDraft, Screen, ScriptChange,
} from '../types/optrane';

interface OptraneStateValue {
  screen: Screen;
  setScreen: (screen: Screen) => void;
  activeProductionId: string;
  setActiveProductionId: (id: string) => void;
  activeRevisionVersion: number;
  setActiveRevisionVersion: (version: number) => void;
  activeScriptVersionId: string | null;
  setActiveScriptVersionId: (id: string | null) => void;
  activeAnalysisId: string | null;
  activeAgentId: string | null;
  setActiveAgentId: (id: string | null) => void;
  setActiveAnalysisId: (id: string | null) => void;
  selectedPlanId: string | null;
  setSelectedPlanId: (id: string | null) => void;
  connectionState: ConnectionState;
  setConnectionState: (state: ConnectionState) => void;
  production: ProductionSummary;
  setProduction: (production: ProductionSummary | ((current: ProductionSummary) => ProductionSummary)) => void;
  changes: ScriptChange[];
  setChanges: (items: ScriptChange[]) => void;
  impacts: ImpactFinding[];
  setImpacts: (items: ImpactFinding[]) => void;
  plans: RecoveryPlan[];
  setPlans: (items: RecoveryPlan[]) => void;
  audit: AuditEvent[];
  setAudit: (items: AuditEvent[] | ((current: AuditEvent[]) => AuditEvent[])) => void;
  analysisEvents: AnalysisEvent[];
  setAnalysisEvents: (items: AnalysisEvent[] | ((current: AnalysisEvent[]) => AnalysisEvent[])) => void;
  graph: GraphResponse | null;
  setGraph: (graph: GraphResponse | null) => void;
  artifacts: ArtifactDelta[];
  setArtifacts: (items: ArtifactDelta[]) => void;
  readinessBefore: number;
  setReadinessBefore: (value: number) => void;
  readinessAfter: number;
  setReadinessAfter: (value: number) => void;
  researchDraft: ResearchDraft | null;
  setResearchDraft: (draft: ResearchDraft | null) => void;
  offline: boolean;
  setOffline: (value: boolean) => void;
  resetClientDemo: () => void;
}

const OptraneStateContext = createContext<OptraneStateValue | null>(null);
const defaultProductionId = import.meta.env.VITE_OPTRANE_DEMO_PRODUCTION_ID ?? localStorage.getItem('optrane.activeProductionId') ?? 'bootstrap';

function loadCachedProduction(): ProductionSummary {
  try {
    const cached = cache.loadProduction();
    if (cached) return { ...cached, offlineSnapshot: true };
  } catch { /* malformed cache */ }
  return demoProduction;
}

export function OptraneStateProvider({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<Screen>('control');
  const [activeProductionId, setActiveProductionId] = useState(defaultProductionId);
  const [activeRevisionVersion, setActiveRevisionVersion] = useState(demoProduction.currentScriptVersion);
  const [activeScriptVersionId, setActiveScriptVersionId] = useState<string | null>(null);
  const [activeAnalysisId, setActiveAnalysisId] = useState<string | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('DISCONNECTED');
  const [production, setProductionState] = useState<ProductionSummary>(loadCachedProduction);
  const [changes, setChanges] = useState<ScriptChange[]>([]);
  const [impacts, setImpacts] = useState<ImpactFinding[]>([]);
  const [plans, setPlans] = useState<RecoveryPlan[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [analysisEvents, setAnalysisEvents] = useState<AnalysisEvent[]>([]);
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactDelta[]>([]);
  const [readinessBefore, setReadinessBefore] = useState(94);
  const [readinessAfter, setReadinessAfter] = useState(68);
  const [researchDraft, setResearchDraft] = useState<ResearchDraft | null>(null);
  const [offline, setOffline] = useState(false);

  const setProduction: OptraneStateValue['setProduction'] = useCallback((value) => {
    setProductionState((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      cache.saveProduction({ ...next, offlineSnapshot: false });
      return next;
    });
  }, []);

  const resetClientDemo = useCallback(() => {
    setScreen('control');
    setActiveProductionId(defaultProductionId);
    setActiveRevisionVersion(7);
    setActiveAnalysisId(null);
    setActiveAgentId(null);
    setSelectedPlanId(null);
    setConnectionState('DISCONNECTED');
    setProductionState(demoProduction);
    setChanges(demoChanges);
    setImpacts(demoImpacts);
    setPlans(demoPlans);
    setAudit(demoAudit);
    setAnalysisEvents([]);
    setGraph(null);
    setArtifacts([]);
    setReadinessBefore(94);
    setReadinessAfter(68);
    setResearchDraft(null);
    setOffline(false);
  }, []);

  const value = useMemo<OptraneStateValue>(() => ({
    screen, setScreen, activeProductionId, setActiveProductionId, activeRevisionVersion, setActiveRevisionVersion,
    activeScriptVersionId, setActiveScriptVersionId,
    activeAnalysisId, setActiveAnalysisId, activeAgentId, setActiveAgentId, selectedPlanId, setSelectedPlanId, connectionState, setConnectionState,
    production, setProduction, changes, setChanges, impacts, setImpacts, plans, setPlans, audit, setAudit,
    analysisEvents, setAnalysisEvents, graph, setGraph, artifacts, setArtifacts, readinessBefore, setReadinessBefore,
    readinessAfter, setReadinessAfter, researchDraft, setResearchDraft, offline, setOffline, resetClientDemo
  }), [
    screen, activeProductionId, activeRevisionVersion, activeScriptVersionId, activeAnalysisId, activeAgentId, selectedPlanId, connectionState, production,
    setProduction, changes, impacts, plans, audit, analysisEvents, graph, artifacts, readinessBefore, readinessAfter, researchDraft,
    offline, resetClientDemo
  ]);

  return <OptraneStateContext.Provider value={value}>{children}</OptraneStateContext.Provider>;
}

export function useOptraneState(): OptraneStateValue {
  const value = useContext(OptraneStateContext);
  if (!value) throw new Error('useOptraneState must be used inside OptraneStateProvider');
  return value;
}
