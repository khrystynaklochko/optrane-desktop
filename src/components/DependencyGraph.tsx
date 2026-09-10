import type { GraphResponse } from '../types/optrane';

export function DependencyGraph({ graph }: { graph: GraphResponse }) {
  const centerX = 360;
  const centerY = 210;
  const center = graph.nodes.find((n) => n.type === 'SCENE') ?? graph.nodes[0];
  const others = graph.nodes.filter((n) => n.id !== center?.id);
  const positions = new Map<string, { x: number; y: number }>();
  if (center) positions.set(center.id, { x: centerX, y: centerY });
  others.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(others.length, 1) - Math.PI / 2;
    positions.set(node.id, { x: centerX + Math.cos(angle) * 235, y: centerY + Math.sin(angle) * 145 });
  });
  return <svg className="dependency-svg" viewBox="0 0 720 430" role="img" aria-label="Scene dependency graph">
    {graph.edges.map((edge, i) => {
      const a = positions.get(edge.source); const b = positions.get(edge.target);
      if (!a || !b) return null;
      return <g key={`${edge.source}-${edge.target}-${i}`}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y}/><text x={(a.x+b.x)/2} y={(a.y+b.y)/2 - 5}>{edge.relation}</text></g>;
    })}
    {graph.nodes.map((node) => {
      const p = positions.get(node.id); if (!p) return null;
      const stateClass = (node.state ?? 'unknown').toLowerCase().replaceAll('_', '-');
      const label = node.label ?? node.id ?? 'Node';
      const type = node.type ?? 'NODE';
      return <g key={node.id} className={`graph-node graph-${stateClass}`} transform={`translate(${p.x},${p.y})`}>
        <circle r={type === 'SCENE' ? 44 : 34}/><text textAnchor="middle" y="-3">{type}</text><text textAnchor="middle" y="13">{label.slice(0, 18)}</text>
      </g>;
    })}
  </svg>;
}
