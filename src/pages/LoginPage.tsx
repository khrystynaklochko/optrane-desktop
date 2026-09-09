import { useEffect, useState } from 'react';
import { probeGatewayPairing } from '../api/gateway';
import { OPTRANE_WEB_BASE } from '../config/optrane';
import { useAuthState } from '../state/AuthState';

export function LoginPage() {
  const auth = useAuthState();
  const [error, setError] = useState('');
  const [gatewayState, setGatewayState] = useState<'checking' | 'ready' | 'bootstrap-blocked' | 'backend-outdated'>('checking');

  useEffect(() => {
    let alive = true;
    void probeGatewayPairing()
      .then((state) => { if (alive) setGatewayState(state); })
      .catch(() => { if (alive) setGatewayState('backend-outdated'); });
    return () => { alive = false; };
  }, []);

  const verify = async () => {
    setError('');
    try { await auth.verifyOnWebsite(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start browser verification'); }
  };

  const finish = async () => {
    setError('');
    try { await auth.finishWebsiteVerification(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Website verification is not complete yet'); }
  };

  return <div className="auth-shell">
    <section className="auth-visual">
      <div className="auth-brand"><div className="brand-mark large">O</div><div><b>OPTRANE</b><span>Autonomous Operations</span></div></div>
      <div className="auth-copy">
        <span className="eyebrow">DESKTOP CONTROL SYSTEM</span>
        <h1>One verified account.<br/>One governed gateway.<br/>No service secrets.</h1>
        <p>OPTRANE Command authenticates through the OPTRANE website. After verification, the desktop talks only to the Lovable OPTRANE gateway; agent governance, Google Agent Runtime and ClickHouse stay behind it.</p>
      </div>
      <div className="auth-stack">
        <div><span>ACCOUNT</span><b>OPTRANE Website</b></div><i>→</i><div><span>SESSION</span><b>OPTRANE</b></div><i>→</i><div><span>GATEWAY</span><b>Lovable API</b></div>
      </div>
    </section>
    <section className="auth-panel">
      <div className="auth-card">
        <span className="eyebrow">SECURE DESKTOP PAIRING</span>
        <h2>Verify your OPTRANE account</h2>
        <p className="auth-description">Sign in or create your account on <b>{new URL(OPTRANE_WEB_BASE).hostname}</b>. The browser verifies your identity; this desktop receives only an OPTRANE user session issued by the gateway.</p>
        <button className="primary wide" disabled={auth.verificationBusy} onClick={() => void verify()}>{auth.verificationBusy ? 'Opening verification…' : auth.verification ? 'Open verification website again' : 'Continue on OPTRANE website'}</button>
        {auth.verification && <div className="browser-verification-card"><span className="status-dot"/><div><b>Verification request active</b><small>Request {auth.verification.requestId.slice(0, 12)}… · expires {auth.verification.expiresAt ? new Date(auth.verification.expiresAt).toLocaleTimeString() : 'soon'}</small></div></div>}
        {auth.verification && <button className="ghost wide" disabled={auth.verificationBusy} onClick={() => void finish()}>I verified — reconnect now</button>}
        {gatewayState !== 'checking' && gatewayState !== 'ready' && <div className="auth-message error">Desktop pairing is not available on the production gateway yet. The Lovable project still needs the latest `backend/lovable` deployment (`itrain-api` plus the `/desktop/verify` page). After that is published, restart pairing here.</div>}
        {(auth.verificationMessage || error) && <div className={`auth-message ${error ? 'error' : ''}`}>{error || auth.verificationMessage}</div>}
        {auth.verification && <small className="auth-security">After you verify on the website, click “I verified — reconnect now” if OPTRANE Command does not reopen automatically.</small>}
        {(import.meta.env.VITE_OPTRANE_ALLOW_ANONYMOUS_DEMO ?? 'false') === 'true' && <><div className="auth-divider"><span>demo</span></div><button className="ghost wide" onClick={() => void auth.startAnonymousDemo()}>Open isolated demo session</button></>}
        <small className="auth-security">The OPTRANE session is stored through the operating-system credential store in Tauri and refreshed only through the OPTRANE gateway. The desktop never receives governance-provider, Google Cloud, ClickHouse, MCP, peer-signing or service-role credentials.</small>
      </div>
    </section>
  </div>;
}
