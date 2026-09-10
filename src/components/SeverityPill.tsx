import type { Severity } from '../types/optrane';
export function SeverityPill({ severity }: { severity: Severity }) {
  return <span className={`severity severity-${severity.toLowerCase()}`}>{severity}</span>;
}
