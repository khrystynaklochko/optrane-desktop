import type { AuditEvent, ImpactFinding, ProductionSummary, RecoveryPlan, ScriptChange } from '../types/optrane';

export const demoProduction: ProductionSummary = {
  productionId: 'nightfall-demo', title: 'NIGHTFALL', readiness: 94, scenes: 8, crew: 26,
  cast: 6, locations: 2, plannedCost: 41200, currentScriptVersion: 7,
  riskCounts: { CRITICAL: 1, HIGH: 2, WATCH: 3 }, shootDayLabel: 'Tomorrow · Shoot Day 8'
};

export const demoChanges: ScriptChange[] = [
  { id: 'c1', scene: '42', type: 'ELEMENT_ADDED', category: 'MINOR', label: 'Child performer' },
  { id: 'c2', scene: '42', type: 'ELEMENT_ADDED', category: 'SPECIAL_EQUIPMENT', label: 'Drone establishing shot' },
  { id: 'c3', scene: '42', type: 'ELEMENT_ADDED', category: 'STUNT', label: 'Vehicle stunt' },
  { id: 'c4', scene: '42', type: 'ELEMENT_ADDED', category: 'SPECIAL_EFFECT', label: 'Rain effect' }
];

export const demoImpacts: ImpactFinding[] = [
  { id: 'i1', category: 'PERMIT', severity: 'CRITICAL', rawSeverity: 'CRITICAL', status: 'UNVERIFIED', reason: 'Drone equipment was added and no matching authorization record is linked to Scene 42.', evidence: 'Scene 42 → Warehouse 07 → no active drone authorization record' },
  { id: 'i2', category: 'SAFETY', severity: 'HIGH', rawSeverity: 'HIGH', status: 'MISSING', reason: 'Vehicle stunt was added and no stunt coordinator assignment is linked to Scene 42.', evidence: 'Scene 42 → STUNT → coordinator assignment missing' },
  { id: 'i3', category: 'WORK RULE', severity: 'WATCH', rawSeverity: 'MEDIUM', status: 'VERIFY_REQUIRED', reason: 'A child performer was added and the production has no linked work-rule verification record.', evidence: 'Minor performer added; verification record not present' },
  { id: 'i4', category: 'EQUIPMENT', severity: 'WATCH', rawSeverity: 'MEDIUM', status: 'AT_CAPACITY', reason: 'The current picture-vehicle allocation is already at capacity for Shoot Day 8.', evidence: 'Vehicle allocation 4/4' },
  { id: 'i5', category: 'CALL SHEET', severity: 'LOW', rawSeverity: 'LOW', status: 'STALE', reason: 'The call sheet predates the active script revision.', evidence: 'Call sheet v7 < script v8' }
];

export const demoPlans: RecoveryPlan[] = [
  { id: 'plan-a', code: 'A', title: 'Preserve schedule', costDelta: 2100, scheduleDeltaMinutes: 0, risk: 'MEDIUM', changes: 3, actions: ['Add stunt coordinator', 'Add drone operator', 'Verify minor requirements'], assumptions: ['Resources can be sourced the same day'] },
  { id: 'plan-b', code: 'B', title: 'Reorder Scenes 42 and 44', costDelta: 600, scheduleDeltaMinutes: -61, risk: 'LOW', changes: 5, recommended: true, actions: ['Shoot Scene 44 first', 'Move Scene 42 to 19:20', 'Refresh call sheet', 'Verify drone authorization'], assumptions: ['Warehouse remains available through 23:00'] },
  { id: 'plan-c', code: 'C', title: 'Move Scene 42', costDelta: 3800, scheduleDeltaMinutes: 0, risk: 'LOW', changes: 2, actions: ['Move Scene 42 to next day', 'Extend location hold'], assumptions: ['Location can be extended'] }
];

export const demoAudit: AuditEvent[] = [
  { id: 'a0', time: '17:41:58', eventType: 'SCRIPT_BASELINE', actor: 'System', summary: 'NIGHTFALL Script v7 active', source: 'DEMO' },
  { id: 'a1', time: '17:42:02', eventType: 'REVISION_UPLOADED', actor: 'Producer', summary: 'Script v8 uploaded', source: 'DEMO' },
  { id: 'a2', time: '17:42:08', eventType: 'CHANGE_DETECTED', actor: 'Change Agent', summary: '4 material changes detected', source: 'DEMO' },
  { id: 'a3', time: '17:42:11', eventType: 'MCP_QUERY', actor: 'Impact Agent', summary: 'ClickHouse MCP queried production dependencies', source: 'MCP_CLICKHOUSE' },
  { id: 'a4', time: '17:42:14', eventType: 'IMPACT_ANALYSED', actor: 'Impact Agent', summary: '5 unresolved findings identified', source: 'OPTRANE' },
  { id: 'a5', time: '17:42:21', eventType: 'PLAN_GENERATED', actor: 'Recovery Agent', summary: '3 recovery plans generated', source: 'OPTRANE' }
];
