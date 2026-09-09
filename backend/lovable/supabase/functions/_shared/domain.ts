export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type EventStatus = 'STARTED' | 'RUNNING' | 'COMPLETE' | 'FAILED';

export interface SceneElement {
  type: string;
  name: string;
  quantity: number;
  confidence: 'EXPLICIT' | 'INFERRED' | 'UNKNOWN';
  metadata?: Record<string, unknown>;
}

export interface SceneBreakdown {
  scene_number: string;
  heading: string;
  location: string;
  interior_exterior: string;
  day_night: string;
  page_eighths: number;
  description: string;
  elements: SceneElement[];
}

export interface SceneChange {
  id: string;
  scene_number: string;
  change_type: string;
  category: string;
  label: string;
  old_value?: string | null;
  new_value?: string | null;
}

export interface EvidenceRef {
  query_kind: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  source: 'MCP_CLICKHOUSE' | 'POSTGRES' | 'DETERMINISTIC_RULE' | 'MODEL_INFERENCE';
}

export interface ImpactFinding {
  id: string;
  category: string;
  severity: Severity;
  status: string;
  reason: string;
  evidence: EvidenceRef[];
}

export interface RecoveryAction {
  type: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  payload?: Record<string, unknown>;
  human_label: string;
}

export interface RecoveryPlan {
  id: string;
  code: 'A' | 'B' | 'C';
  title: string;
  schedule_delta_minutes: number;
  estimated_cost_delta: number;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  changes: number;
  recommended: boolean;
  actions: RecoveryAction[];
  assumptions: string[];
  unresolved: string[];
}

export const penalties: Record<Severity, number> = {
  CRITICAL: 15,
  HIGH: 8,
  MEDIUM: 4,
  LOW: 1,
};

export function calculateReadiness(findings: ImpactFinding[], base = 100) {
  const penalty = findings.filter((f) => f.status !== 'RESOLVED').reduce((sum, f) => sum + penalties[f.severity], 0);
  return Math.max(0, Math.min(100, base - penalty));
}
