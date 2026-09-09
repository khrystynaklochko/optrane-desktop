export function Metric({ value, label }: { value: string | number; label: string }) {
  return <div className="metric"><strong>{value}</strong><span>{label}</span></div>;
}
