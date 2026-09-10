import type { AnalysisEvent, ConnectionState } from '../types/optrane';
import { deriveRuntimeProof } from '../utils/runtimeProof';

function Step({ label, detail, state }: { label: string; detail: string; state: 'done' | 'running' | 'waiting' | 'failed' }) {
  return <div className={`runtime-step runtime-${state}`}>
    <span className="runtime-node">{state === 'done' ? '✓' : state === 'running' ? '●' : state === 'failed' ? '!' : '○'}</span>
    <div><b>{label}</b><small>{detail}</small></div>
  </div>;
}

export function RuntimeProofCard({ events, connection }: { events: AnalysisEvent[]; connection: ConnectionState }) {
  const proof = deriveRuntimeProof(events);
  const failed = connection === 'FAILED';
  const runtimeState = proof.agentRuntimeVerified ? 'done' : failed && proof.agentRuntimeStarted ? 'failed' : proof.agentRuntimeStarted ? 'running' : 'waiting';
  const mcpState = proof.mcpVerified ? 'done' : failed && proof.mcpStarted ? 'failed' : proof.mcpStarted ? 'running' : 'waiting';
  const mirrorState = proof.clickhouseMirrored ? 'done' : failed ? 'failed' : 'waiting';

  return <article className="runtime-proof-card panel">
    <div className="panel-head">
      <div><span className="eyebrow">VERIFIED CLOUD EXECUTION</span><h2>Google ADK → ClickHouse MCP</h2></div>
      <span className={`runtime-proof-badge ${proof.mcpVerified && proof.adkVerified ? 'verified' : ''}`}>{proof.mcpVerified && proof.adkVerified ? 'VERIFIED' : connection === 'FAILED' ? 'FAILED' : 'IN PROGRESS'}</span>
    </div>
    <div className="runtime-flow">
      <Step label="ClickHouse fact mirror" detail={proof.clickhouseMirrored ? `${proof.mirroredRows} operational facts mirrored to optrane.production_facts` : 'Waiting for production-state mirror'} state={mirrorState}/>
      <span className="runtime-arrow">→</span>
      <Step label="Google Agent Runtime" detail={proof.agentRuntimeVerified ? `ADK agent executed${proof.geminiModel ? ` · ${proof.geminiModel}` : ''}` : 'Waiting for deployed ADK/Gemini agent'} state={runtimeState}/>
      <span className="runtime-arrow">→</span>
      <Step label="ClickHouse MCP" detail={proof.mcpVerified ? `${proof.mcpTool} verified · ${proof.mcpRows} rows · ${proof.readOnly ? 'READ ONLY' : 'write access'}` : 'Waiting for official MCP run_query evidence'} state={mcpState}/>
    </div>
    <div className="runtime-proof-foot">
      <span>Source <b>{proof.source ?? 'pending'}</b></span>
      <span>Tool call <b>{proof.adkVerified ? 'observed' : 'pending'}</b></span>
      <span>Tool response <b>{proof.mcpVerified ? 'observed' : 'pending'}</b></span>
    </div>
  </article>;
}
