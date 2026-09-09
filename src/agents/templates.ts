import type { AgentDataClass, AgentTool, AgentType, RegisterAgentInput } from '../types/optrane';

export const capabilityCatalog = [
  'SCRIPT_READ', 'SCRIPT_ANALYSE', 'BREAKDOWN_GENERATE', 'SCENE_COMPARE', 'CHANGE_DETECTION',
  'PRODUCTION_READ', 'DEPENDENCY_QUERY', 'IMPACT_ANALYSIS', 'ANALYSIS_READ', 'SCHEDULE_READ',
  'SCHEDULE_PROPOSE', 'RECOVERY_GENERATION', 'ARTIFACT_GENERATE', 'COORDINATE_AGENTS', 'APPROVAL_REQUEST', 'SELF_IMPROVEMENT_PROPOSE',
] as const;

export const toolCatalog: AgentTool[] = [
  { toolKey: 'clickhouse.run_query', provider: 'CLICKHOUSE_MCP', accessMode: 'READ' },
  { toolKey: 'optrane.production.read', provider: 'OPTRANE', accessMode: 'READ' },
  { toolKey: 'optrane.scene.read', provider: 'OPTRANE', accessMode: 'READ' },
  { toolKey: 'optrane.analysis.read', provider: 'OPTRANE', accessMode: 'READ' },
  { toolKey: 'optrane.recovery.propose', provider: 'OPTRANE', accessMode: 'PROPOSE' },
  { toolKey: 'optrane.artifact.propose', provider: 'OPTRANE', accessMode: 'PROPOSE' },
];

export const dataClassCatalog = [
  'SCRIPT_CONTENT', 'SCENE_BREAKDOWN', 'CAST_METADATA', 'CREW_METADATA', 'SCHEDULE', 'LOCATION_METADATA',
  'EQUIPMENT_METADATA', 'PRODUCTION_FINANCIALS', 'PERMIT_METADATA', 'INSURANCE_METADATA', 'AUDIT_EVIDENCE',
  'USER_PERSONAL_DATA', 'SECRETS',
] as const;

const standardData = (overrides: Record<string, AgentDataClass['access']> = {}): AgentDataClass[] =>
  dataClassCatalog.map((dataClass) => ({
    dataClass,
    access: overrides[dataClass] ?? (dataClass === 'SECRETS' || dataClass === 'USER_PERSONAL_DATA' ? 'DENIED' : 'ALLOWED'),
  }));

function base(name: string, agentType: AgentType, purpose: string): RegisterAgentInput {
  return {
    name, agentType, purpose, runtime: 'GOOGLE_ADK', model: 'gemini-3.5-flash',
    capabilities: [], tools: [], dataClasses: standardData({ PRODUCTION_FINANCIALS: 'CONDITIONAL' }),
    budget: { currency: 'USD', perRun: 1, daily: 10 },
    selfImprovement: {
      enabled: true,
      rule: 'May improve reasoning strategy, prompts, retrieval order, tool ordering, error recovery and confidence thresholds. It may not add tools, expand permissions or data access, change model or executable code, modify policy, or increase any budget. Improvements are candidates only and require human approval before promotion.',
      allowed: ['PROMPT_VARIANT','PLANNING_STRATEGY','RETRIEVAL_STRATEGY','TOOL_ORDERING','ERROR_RECOVERY_RULE','CONFIDENCE_THRESHOLD'],
      forbidden: ['NEW_TOOL','PERMISSION_ESCALATION','NEW_DATA_CLASS','BUDGET_INCREASE','MODEL_CHANGE','SECRET_ACCESS','POLICY_CHANGE','EXECUTABLE_CODE_CHANGE'],
      requiresHumanApproval: true,
      budget: { currency: 'USD', perIteration: 0.25, daily: 2, maxIterationsPerRun: 2, maxDailyIterations: 10 },
    },
  };
}

export const agentTemplates: Record<Exclude<AgentType, 'CUSTOM'>, RegisterAgentInput> = {
  DIRECTOR: {
    ...base('Production Director', 'DIRECTOR', 'Coordinate governed production agents and request human approval for consequential actions.'),
    capabilities: ['COORDINATE_AGENTS', 'ANALYSIS_READ', 'RECOVERY_GENERATION', 'APPROVAL_REQUEST', 'SELF_IMPROVEMENT_PROPOSE'],
    tools: [toolCatalog[3], toolCatalog[4]],
  },
  BREAKDOWN: {
    ...base('Breakdown Agent', 'BREAKDOWN', 'Convert screenplay material into structured scenes and explicit production elements.'),
    capabilities: ['SCRIPT_READ', 'SCRIPT_ANALYSE', 'BREAKDOWN_GENERATE', 'SELF_IMPROVEMENT_PROPOSE'],
    tools: [toolCatalog[2], toolCatalog[5]],
  },
  REVISION: {
    ...base('Revision Agent', 'REVISION', 'Compare screenplay versions and identify material scene and element changes.'),
    capabilities: ['SCRIPT_READ', 'SCENE_COMPARE', 'CHANGE_DETECTION', 'SELF_IMPROVEMENT_PROPOSE'],
    tools: [toolCatalog[2]],
  },
  IMPACT: {
    ...base('Impact Agent', 'IMPACT', 'Identify the operational blast radius of screenplay changes using verified production evidence.'),
    capabilities: ['SCRIPT_READ', 'PRODUCTION_READ', 'DEPENDENCY_QUERY', 'IMPACT_ANALYSIS', 'SELF_IMPROVEMENT_PROPOSE'],
    tools: [toolCatalog[0], toolCatalog[1], toolCatalog[2]],
  },
  RECOVERY: {
    ...base('Recovery Agent', 'RECOVERY', 'Generate approval-gated recovery alternatives without directly mutating production state.'),
    capabilities: ['ANALYSIS_READ', 'SCHEDULE_READ', 'RECOVERY_GENERATION', 'ARTIFACT_GENERATE', 'SELF_IMPROVEMENT_PROPOSE'],
    tools: [toolCatalog[3], toolCatalog[4], toolCatalog[5]],
  },
  SCHEDULE: {
    ...base('Schedule Agent', 'SCHEDULE', 'Evaluate schedule consequences and propose safe schedule adjustments.'),
    capabilities: ['PRODUCTION_READ', 'SCHEDULE_READ', 'SCHEDULE_PROPOSE', 'SELF_IMPROVEMENT_PROPOSE'],
    tools: [toolCatalog[1], toolCatalog[4]],
  },
  RISK: {
    ...base('Risk Agent', 'RISK', 'Review unresolved production risks and evidence gaps across the active production.'),
    capabilities: ['PRODUCTION_READ', 'DEPENDENCY_QUERY', 'ANALYSIS_READ', 'SELF_IMPROVEMENT_PROPOSE'],
    tools: [toolCatalog[0], toolCatalog[1], toolCatalog[3]],
  },
};

export function templateFor(type: AgentType): RegisterAgentInput {
  if (type === 'CUSTOM') return base('Custom Agent', 'CUSTOM', 'Describe the precise operational purpose of this agent.');
  return JSON.parse(JSON.stringify(agentTemplates[type])) as RegisterAgentInput;
}

export const defaultFleetTypes: AgentType[] = ['DIRECTOR', 'BREAKDOWN', 'REVISION', 'IMPACT', 'RECOVERY'];
