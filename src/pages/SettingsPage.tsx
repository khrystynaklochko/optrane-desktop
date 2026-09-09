import { useEffect, useState } from 'react';
import { api, API_BASE } from '../api/client';
import { OPTRANE_WEB_BASE } from '../config/optrane';
import { useAuthState } from '../state/AuthState';
import type { IntegrationHealth } from '../types/optrane';

function Health({ label, ok, configured, detail }: { label: string; ok?: boolean; configured?: boolean; detail?: string }) {
  const status = ok ? 'ONLINE' : configured === false ? 'NOT SET' : 'CHECK';
  return <div className="integration-row"><span className={`health-dot ${ok ? 'ok' : 'bad'}`}/><div><b>{label}</b><small>{detail ?? (ok ? 'Connected' : configured === false ? 'Not configured' : 'Unavailable')}</small></div><strong>{status}</strong></div>;
}

export function SettingsPage({ onToast }: { onToast: (message: string) => void }) {
  const auth = useAuthState();
  const [health, setHealth] = useState<IntegrationHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    api.integrationHealth().then(setHealth).catch((error) => onToast(error instanceof Error ? error.message : 'Could not check integrations')).finally(() => setLoading(false));
  };
  useEffect(refresh, []);
  const strict = health?.strictMode;

  return <section className="page">
    <div className="page-head"><div><span className="eyebrow">SYSTEM</span><h1>Settings & Integrations</h1><p>OPTRANE Command keeps one website-verified user session and calls one Lovable gateway. Provider credentials, peer signing, policy enforcement and downstream service calls stay server-side.</p></div><button className="ghost" disabled={loading} onClick={refresh}>{loading ? 'Checking…' : 'Refresh health'}</button></div>

    {strict && <div className={`strict-banner ${strict.ready ? 'ready' : 'blocked'}`}><div><span className="eyebrow">STRICT EXECUTION MODE</span><b>{strict.ready ? 'Governed runtime path ready' : 'Governed runtime path blocked'}</b><small>Agent Runtime {strict.requireAgentRuntime ? 'required' : 'optional'} · ClickHouse MCP {strict.requireMcp ? 'required' : 'optional'} · Governance {strict.requireGovernance ? 'required' : 'optional'}</small></div><strong>{strict.ready ? 'READY' : 'ACTION REQUIRED'}</strong></div>}

    <div className="settings-grid">
      <div className="panel"><span className="eyebrow">ACCOUNT</span><h3>Website-verified identity</h3><div className="account-card"><div className="avatar">{(auth.user?.email?.[0] ?? 'U').toUpperCase()}</div><div><b>{auth.user?.email ?? 'Anonymous demo user'}</b><small>{auth.user?.id}</small></div></div><div className="gateway-details"><small>Verified by</small><b>{new URL(OPTRANE_WEB_BASE).hostname}</b><small>Desktop gateway</small><code>{API_BASE}</code></div><button className="ghost wide" onClick={() => void auth.signOut().catch((error) => onToast(error.message))}>Sign out of desktop</button></div>

      <div className="panel"><span className="eyebrow">BACKEND CONNECTIONS</span><h3>Server-side integrations</h3><div className="integration-list">
        <Health label="Google Agent Runtime / ADK" ok={health?.agentRuntime?.reachable} configured={health?.agentRuntime?.configured} detail={health?.agentRuntime?.reachable ? 'Deployed reasoning engine reachable · ADK enabled' : undefined}/>
        <Health label="Gemini / Vertex" ok={health?.gemini?.reachable} configured={health?.gemini?.configured} detail={health?.gemini?.model ? `Model ${health.gemini.model}` : undefined}/>
        <Health label="ClickHouse Cloud" ok={health?.clickhouse?.reachable} configured={health?.clickhouse?.configured} detail={health?.clickhouse?.database ? `Database ${health.clickhouse.database}` : undefined}/>
        <Health label="Official ClickHouse MCP" ok={health?.mcp?.reachable} configured={health?.mcp?.configured} detail={health?.mcp?.reachable ? `${health.mcp.tool ?? 'run_query'} · ${health.mcp.readOnly !== false ? 'READ ONLY' : 'policy controlled'}` : undefined}/>
        <Health label="Agent governance" ok={health?.governance?.reachable && health?.governance?.connected} configured={health?.governance?.configured} detail={health?.governance?.provider ? `${health.governance.provider} · ${health.governance.status ?? (health.governance.connected ? 'CONNECTED' : 'DISCONNECTED')}` : undefined}/>
      </div></div>

      <div className="panel full-span"><span className="eyebrow">PRIVATE PEER BOUNDARY</span><h3>Peer establishment is intentionally absent from this desktop</h3><p className="muted">The OPTRANE backend establishes and signs the provider peer connection with server-held keys. Connection IDs, nonces, signatures, provider URLs, API credentials and policy-native payloads are never returned to OPTRANE Command.</p><div className="security-grid"><span>Website verifies human</span><span>Desktop receives user session</span><span>Backend signs peer requests</span><span>Provider enforces agent policy</span><span>Webhook is signature checked</span><span>Replay protection enabled</span></div></div>

      <div className="panel full-span cloud-path-panel"><span className="eyebrow">BROKERED RUNTIME PATH</span><h3>The desktop calls only OPTRANE</h3><div className="cloud-path"><span>OPTRANE Command</span><i>→</i><span>Lovable OPTRANE API</span><i>→</i><span>Governance + Google ADK</span><i>→</i><span>mcp-clickhouse</span><i>→</i><span>ClickHouse Cloud</span></div><p>All provider-native request/response logic is normalized by the OPTRANE backend before anything returns to Tauri.</p></div>

      <div className="panel full-span"><span className="eyebrow">SECURITY BOUNDARY</span><h3>What this desktop intentionally cannot access</h3><div className="security-grid"><span>Google service account</span><span>ClickHouse password</span><span>Governance provider credentials</span><span>Peer private signing key</span><span>MCP bearer token</span><span>Supabase service role</span><span>Provider API endpoints</span><span>Webhook secret</span></div></div>
    </div>
  </section>;
}
