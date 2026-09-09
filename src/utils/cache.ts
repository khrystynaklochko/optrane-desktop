import type { AnalysisResult, AuditEvent, ProductionSummary } from '../types/optrane';

const prefix = 'optrane.snapshot.';

function put(key: string, value: unknown) {
  try { localStorage.setItem(`${prefix}${key}`, JSON.stringify({ value, savedAt: new Date().toISOString() })); } catch { /* cache optional */ }
}
function get<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${prefix}${key}`);
    if (!raw) return null;
    return (JSON.parse(raw) as { value: T }).value;
  } catch { return null; }
}

export const cache = {
  saveProduction: (value: ProductionSummary) => put('production', value),
  loadProduction: () => get<ProductionSummary>('production'),
  saveAudit: (value: AuditEvent[]) => put('audit', value.slice(-30)),
  loadAudit: () => get<AuditEvent[]>('audit'),
  saveAnalysis: (value: AnalysisResult) => put('analysis', value),
  loadAnalysis: () => get<AnalysisResult>('analysis')
};
