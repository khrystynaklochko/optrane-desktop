export type Severity = 'CRITICAL' | 'HIGH' | 'WATCH' | 'LOW';
export type RawSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type Screen =
  | 'control' | 'new-production' | 'revision' | 'change-review' | 'impact' | 'recovery' | 'graph' | 'audit'
  | 'agents' | 'agent-register' | 'agent-detail' | 'agent-runs' | 'settings' | 'demo-recording';
export type ConnectionState = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED' | 'COMPLETE' | 'FAILED';
export type UploadState = 'IDLE' | 'SELECTED' | 'SIGNING' | 'UPLOADING' | 'VERIFYING' | 'READY' | 'ANALYSING' | 'FAILED';

export interface ProductionSummary {
  productionId: string;
  title: string;
  readiness: number;
  scenes: number;
  crew: number;
  cast: number;
  locations: number;
  plannedCost: number;
  currentScriptVersion: number;
  riskCounts: Record<string, number>;
  shootDayLabel: string;
  offlineSnapshot?: boolean;
}

export interface ScriptChange {
  id: string;
  scene: string;
  type: string;
  category: string;
  label: string;
  ignored?: boolean;
}

export interface EvidenceRef {
  query_kind: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  source: 'MCP_CLICKHOUSE' | 'DETERMINISTIC_RULE' | 'MODEL_INFERENCE';
}

export interface ImpactFinding {
  id: string;
  category: string;
  severity: Severity;
  rawSeverity?: RawSeverity;
  status: string;
  reason: string;
  evidence: string;
  evidenceRefs?: EvidenceRef[];
}

export interface RecoveryPlan {
  id: string;
  code: 'A' | 'B' | 'C';
  title: string;
  costDelta: number;
  scheduleDeltaMinutes: number;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  changes: number;
  recommended?: boolean;
  actions: string[];
  assumptions: string[];
  unresolved?: string[];
}

export interface AuditEvent {
  id: string;
  time: string;
  eventType: string;
  actor: string;
  summary: string;
  source?: string;
  payload?: Record<string, unknown>;
}

export interface AnalysisEvent {
  id: string;
  type: string;
  actor: string;
  message: string;
  status: 'STARTED' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  createdAt: string;
  payload: Record<string, unknown>;
  sequence?: number;
}


export interface AnalysisResult {
  analysisId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  revisionVersion: number;
  changes: ScriptChange[];
  impacts: ImpactFinding[];
  readinessBefore: number;
  readinessAfter: number;
}

export interface ArtifactDelta {
  kind: 'BREAKDOWN' | 'SCHEDULE' | 'CALL_SHEET' | 'ACTION_LIST';
  title: string;
  lines: string[];
}

export interface GraphNode { id: string; type: string; label: string; state: string; }
export interface GraphEdge { source: string; target: string; relation: string; }
export interface GraphResponse { nodes: GraphNode[]; edges: GraphEdge[]; }

export interface UploadTicket {
  script_version: number;
  upload_id: string;
  upload_path: string;
  upload_token: string;
  bucket: string;
  expires_at: string;
}

// Governed agent identities. The desktop only sees normalized OPTRANE governance state;
// provider credentials, peer connection material, and private authorization payloads stay server-side.
export type AgentType = 'DIRECTOR' | 'BREAKDOWN' | 'REVISION' | 'IMPACT' | 'RECOVERY' | 'SCHEDULE' | 'RISK' | 'CUSTOM';
export type AgentStatus = 'REGISTERING' | 'ACTIVE' | 'REGISTRATION_FAILED' | 'RESTRICTED' | 'REVOKED';
export type AgentTrustStatus = 'TRUSTED' | 'VERIFIED' | 'CONDITIONAL' | 'REVIEW_REQUIRED' | 'RESTRICTED' | 'REVOKED' | string;
export type ToolAccessMode = 'READ' | 'PROPOSE' | 'EXECUTE';
export type DataAccess = 'ALLOWED' | 'CONDITIONAL' | 'DENIED';
export type ImprovementType = 'PROMPT_VARIANT' | 'PLANNING_STRATEGY' | 'RETRIEVAL_STRATEGY' | 'TOOL_ORDERING' | 'ERROR_RECOVERY_RULE' | 'CONFIDENCE_THRESHOLD';
export type ImprovementStatus = 'PROPOSED' | 'EVALUATING' | 'APPROVED' | 'REJECTED' | 'PROMOTED';

export interface AgentCapability { capability: string; description?: string; status?: string; }
export interface AgentTool {
  toolKey: string;
  provider: string;
  accessMode: ToolAccessMode;
  bindingId?: string;
}
export interface AgentDataClass { dataClass: string; access: DataAccess; }
export interface AgentBudget {
  currency: string;
  perRun: number;
  daily: number;
  spentToday?: number;
  remainingToday?: number;
}

export interface SelfImprovementBudget {
  currency: string;
  perIteration: number;
  daily: number;
  maxIterationsPerRun: number;
  maxDailyIterations?: number;
  spentToday?: number;
  remainingToday?: number;
  iterationsToday?: number;
}

export interface SelfImprovementPolicy {
  enabled: boolean;
  rule: string;
  allowed: ImprovementType[];
  forbidden: string[];
  requiresHumanApproval: boolean;
  budget: SelfImprovementBudget;
}

export interface GovernancePassport {
  provider?: string;
  passportId: string;
  passportVersion: string;
  trustStatus: AgentTrustStatus;
  trustScore: number | null;
  lastSyncAt?: string;
}

export interface ProductionAgent {
  id: string;
  productionId: string;
  name: string;
  agentType: AgentType;
  purpose: string;
  runtime: string;
  model?: string;
  status: AgentStatus;
  parentAgentId?: string;
  capabilities: AgentCapability[];
  tools: AgentTool[];
  dataClasses: AgentDataClass[];
  budget?: AgentBudget;
  selfImprovement?: SelfImprovementPolicy;
  governance?: GovernancePassport | null;
  registrationError?: string | null;
  createdAt?: string;
}

export interface RegisterAgentInput {
  name: string;
  agentType: AgentType;
  purpose: string;
  runtime: 'GOOGLE_ADK' | string;
  model: string;
  capabilities: string[];
  tools: AgentTool[];
  dataClasses: AgentDataClass[];
  budget: AgentBudget;
  selfImprovement: SelfImprovementPolicy;
}

export interface AgentRun {
  id: string;
  externalRunId?: string;
  agentId: string;
  governanceRunId?: string;
  purpose: string;
  status: 'QUEUED' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'DENIED' | 'AWAITING_APPROVAL' | string;
  budgetLimit?: number;
  spent?: number;
  startedAt?: string;
  completedAt?: string;
}
export interface AgentEvidence {
  id: string;
  agentId: string;
  runId?: string;
  eventType: string;
  tool?: string;
  decision?: 'ALLOW' | 'DENY' | 'HOLD_FOR_APPROVAL' | string;
  success?: boolean;
  summary: string;
  createdAt: string;
}

export interface ImprovementCandidate {
  id: string;
  agentId: string;
  runId?: string;
  type: ImprovementType;
  currentValue?: string;
  proposedValue: string;
  rationale?: string;
  evidence?: Record<string, unknown>;
  estimatedCost: number;
  actualCost?: number;
  status: ImprovementStatus;
  createdAt: string;
  approvedAt?: string;
}

export interface IntegrationHealth {
  governance?: { configured: boolean; reachable: boolean; connected?: boolean; provider?: string; status?: string };
  gemini?: { configured?: boolean; reachable?: boolean; model?: string };
  agentRuntime?: { configured?: boolean; reachable?: boolean; resource?: string; adk?: boolean };
  clickhouse?: { configured?: boolean; reachable?: boolean; database?: string };
  mcp?: { configured?: boolean; reachable?: boolean; tool?: string; readOnly?: boolean };
  strictMode?: { requireMcp: boolean; requireAgentRuntime: boolean; requireGovernance?: boolean; ready: boolean };
}

export interface RuntimeProof {
  clickhouseMirrored: boolean;
  mirroredRows: number;
  agentRuntimeStarted: boolean;
  agentRuntimeVerified: boolean;
  adkVerified: boolean;
  geminiModel?: string;
  mcpStarted: boolean;
  mcpVerified: boolean;
  mcpTool: string;
  mcpRows: number;
  source?: string;
  readOnly: boolean;
}
