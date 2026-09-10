import { useEffect, useState } from 'react';
import { api, apiBase } from '../api/client';
import { loadDeviceToken } from '../api/session';
import {
  getOptraneApiEnvironment,
  getOptraneWebBase,
  OPTRANE_PREVIEW_BASE,
  OPTRANE_PRODUCTION_BASE,
  setOptraneApiEnvironment,
} from '../config/optrane';
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
  const [apiEnv, setApiEnv] = useState(getOptraneApiEnvironment());
  const [deviceToken, setDeviceToken] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    api.integrationHealth().then(setHealth).catch((error) => onToast(error instanceof Error ? error.message : 'Could not check integrations')).finally(() => setLoading(false));
  };

  useEffect(refresh, []);
  useEffect(() => { void loadDeviceToken().then(setDeviceToken); }, []);

  const switchEnv = (env: 'production' | 'preview') => {
    setOptraneApiEnvironment(env);
    setApiEnv(env);
    onToast(`Gateway switched to ${env}. Reloading OPTRANE Command…`);
    window.setTimeout(() => window.location.reload(), 400);
  };

  const strict = health?.strictMode;
  const google = health?.googleCloud ?? health?.agentRuntime;
  const geminiModel = health?.gemini?.model ?? google?.model;
  const googleBackend = google?.backend ?? health?.agentRuntime?.resource;

  return <section className="page">
    <div className="page-head"><div><span className="eyebrow">SYSTEM</span><h1>Settings &amp; Integrations</h1><p>OPTRANE Command keeps one verified user session and calls one Lovable gateway. Parallel, Google Cloud, ClickHouse and governance credentials stay server-side.</p></div><button className="ghost" disabled={loading} onClick={refresh}>{loading ? 'Checking…' : 'Refresh health'}</button></div>

    {strict && <div className={`strict-banner ${strict.ready ? 'ready' : 'blocked'}`}><div><span className="eyebrow">STRICT EXECUTION MODE</span><b>{strict.ready ? 'Governed runtime path ready' : 'Governed runtime path blocked'}</b><small>Agent Runtime {strict.requireAgentRuntime ? 'required' : 'optional'} · ClickHouse MCP {strict.requireMcp ? 'required' : 'optional'} · Governance {strict.requireGovernance ? 'required' : 'optional'}</small></div><strong>{strict.ready ? 'READY' : 'ACTION REQUIRED'}</strong></div>}

    <div className="settings-grid">
      <div className="panel"><span className="eyebrow">ACCOUNT</span><h3>Signed-in producer</h3><div className="account-card"><div className="avatar">{(auth.user?.email?.[0] ?? 'U').toUpperCase()}</div><div><b>{auth.user?.email ?? 'Not signed in'}</b><small>{auth.user?.id}</small></div></div><div className="gateway-details"><small>Hosted project</small><a href={OPTRANE_PRODUCTION_BASE} target="_blank" rel="noreferrer"><b>{OPTRANE_PRODUCTION_BASE}</b></a><small>Active gateway</small><code>{apiBase()}</code><small>Paired device</small><code>{deviceToken ? `${deviceToken.slice(0, 10)}…` : 'No device token stored'}</code></div><button className="ghost wide" onClick={() => void auth.signOut().catch((error) => onToast(error.message))}>Sign out and clear keychain</button></div>

      <div className="panel"><span className="eyebrow">GATEWAY</span><h3>API environment</h3><div className="auth-tabs"><button className={apiEnv === 'production' ? 'active' : ''} onClick={() => switchEnv('production')}>Production</button><button className={apiEnv === 'preview' ? 'active' : ''} onClick={() => switchEnv('preview')}>Preview dev</button></div><div className="gateway-details"><small>Production</small><code>{OPTRANE_PRODUCTION_BASE}/api/public/itrain-api</code><small>Preview</small><code>{OPTRANE_PREVIEW_BASE}/api/public/itrain-api</code><small>Website</small><b>{getOptraneWebBase()}</b></div></div>

      <div className="panel"><span className="eyebrow">BACKEND CONNECTIONS</span><h3>Server-side integrations</h3><div className="integration-list">
        <Health label="Google Cloud / Agent Runtime" ok={health?.agentRuntime?.reachable ?? google?.reachable} configured={health?.agentRuntime?.configured ?? google?.configured} detail={googleBackend ? `Backend ${googleBackend}${geminiModel ? ` · ${geminiModel}` : ''}` : geminiModel}/>
        <Health label="Gemini model" ok={health?.gemini?.reachable} configured={health?.gemini?.configured} detail={geminiModel ? `Model ${geminiModel}` : undefined}/>
        <Health label="Parallel web research" ok={health?.parallel?.reachable} configured={health?.parallel?.configured} detail={health?.parallel?.status ? `Status ${health.parallel.status}` : 'Used by Location & Clearance Scout'}/>
        <Health label="ClickHouse Cloud" ok={health?.clickhouse?.reachable} configured={health?.clickhouse?.configured} detail={health?.clickhouse?.database ? `Database ${health.clickhouse.database}` : undefined}/>
        <Health label="Official ClickHouse MCP" ok={health?.mcp?.reachable} configured={health?.mcp?.configured} detail={health?.mcp?.reachable ? `${health.mcp.tool ?? 'run_query'} · ${health.mcp.readOnly !== false ? 'READ ONLY' : 'policy controlled'}` : undefined}/>
        <Health label="Agent governance" ok={health?.governance?.reachable && health?.governance?.connected} configured={health?.governance?.configured} detail={health?.governance?.provider ? `${health.governance.provider} · ${health.governance.status ?? (health.governance.connected ? 'CONNECTED' : 'DISCONNECTED')}` : undefined}/>
      </div></div>

      <div className="panel full-span"><span className="eyebrow">HELP</span><h3>Hosted OPTRANE project</h3><p className="muted">Judges and producers can open the hosted website for account creation, pairing codes, and production administration.</p><div className="button-row"><a className="ghost" href={OPTRANE_PRODUCTION_BASE} target="_blank" rel="noreferrer">Open hosted site</a><a className="ghost" href="https://github.com/khrystynaklochko/optrane-desktop" target="_blank" rel="noreferrer">Public repository</a></div></div>

      <div className="panel full-span"><span className="eyebrow">SECURITY BOUNDARY</span><h3>What this desktop intentionally cannot access</h3><div className="security-grid"><span>Google service account</span><span>ClickHouse password</span><span>Parallel API key</span><span>Governance provider credentials</span><span>Peer private signing key</span><span>MCP bearer token</span><span>Supabase service role</span><span>Provider API endpoints</span></div></div>
    </div>
  </section>;
}
