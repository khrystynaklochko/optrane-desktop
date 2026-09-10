import { useEffect, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { cancelWebsiteVerification } from '../api/browserAuth';
import { probeGatewayPairing } from '../api/gateway';
import {
  formatPairingCodeInput,
  isCompletePairingCode,
  LEGACY_PAIRING_WEBSITE,
  sanitizePairingCodeInput,
} from '../api/legacyPairing';
import { getOptraneWebBase } from '../config/optrane';
import { useAuthState } from '../state/AuthState';

type LoginMode = 'pair' | 'email';

function inTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function LoginPage() {
  const auth = useAuthState();
  const codeRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<LoginMode>('pair');
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    void probeGatewayPairing().then(() => cancelWebsiteVerification()).catch(() => cancelWebsiteVerification());
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => codeRef.current?.focus(), 150);
    return () => window.clearTimeout(timer);
  }, [mode]);

  const claim = async () => {
    setError('');
    const normalizedCode = formatPairingCodeInput(pairingCode);
    setPairingCode(normalizedCode);
    try { await auth.claimPairingCode(normalizedCode, password); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not claim the pairing code'); }
  };

  const signIn = async () => {
    setError('');
    try { await auth.signInWithEmail(email, password); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not sign in'); }
  };

  const openWebsite = async () => {
    try {
      if (inTauri()) await openUrl(LEGACY_PAIRING_WEBSITE);
      else window.open(LEGACY_PAIRING_WEBSITE, '_blank', 'noopener,noreferrer');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open the OPTRANE website');
    }
  };

  const websiteHost = new URL(getOptraneWebBase()).hostname;
  const canPair = isCompletePairingCode(pairingCode) && password.length >= 8 && !auth.verificationBusy;
  const canSignIn = email.includes('@') && password.length >= 8 && !auth.verificationBusy;

  return <div className="auth-shell">
    <section className="auth-visual">
      <div className="auth-brand"><div className="brand-mark large">O</div><div><b>OPTRANE</b><span>Autonomous Operations</span></div></div>
      <div className="auth-copy">
        <span className="eyebrow">DESKTOP CONTROL SYSTEM</span>
        <h1>One verified account.<br/>One governed gateway.<br/>No service secrets.</h1>
        <p>Pair with a website code or sign in with the same email and password you use on the hosted OPTRANE project.</p>
      </div>
      <div className="auth-stack">
        <div><span>ACCOUNT</span><b>OPTRANE Website</b></div><i>→</i><div><span>SESSION</span><b>OPTRANE</b></div><i>→</i><div><span>GATEWAY</span><b>Lovable API</b></div>
      </div>
    </section>
    <section className="auth-panel">
      <div className="auth-card">
        <span className="eyebrow">SECURE DESKTOP PAIRING</span>
        <h2>Connect OPTRANE Command</h2>
        <div className="auth-tabs">
          <button type="button" className={mode === 'pair' ? 'active' : ''} onClick={() => setMode('pair')}>Pairing code</button>
          <button type="button" className={mode === 'email' ? 'active' : ''} onClick={() => setMode('email')}>Email sign-in</button>
        </div>
        {mode === 'pair' ? <>
          <p className="auth-description">Sign in on <b>{websiteHost}</b>, copy your pairing code (<b>XXXX-XXXX</b>), then enter it here with your website password.</p>
          <button type="button" className="ghost wide" disabled={auth.verificationBusy} onClick={() => void openWebsite()}>Open OPTRANE website</button>
          <form className="auth-form" onSubmit={(event) => { event.preventDefault(); if (canPair) void claim(); }}>
            <label htmlFor="pairing-code">Pairing code</label>
            <input id="pairing-code" ref={codeRef} type="text" inputMode="text" autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false} maxLength={9} value={pairingCode} onChange={(event) => setPairingCode(sanitizePairingCodeInput(event.target.value))} onBlur={() => setPairingCode((current) => formatPairingCodeInput(current))} onPaste={(event) => { event.preventDefault(); setPairingCode(formatPairingCodeInput(event.clipboardData.getData('text'))); }} placeholder="CQN9-Q4JZ" disabled={auth.verificationBusy}/>
            <label htmlFor="pair-password">Website password</label>
            <input id="pair-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Same password as the OPTRANE website" disabled={auth.verificationBusy}/>
            <button type="submit" className="primary wide" disabled={!canPair}>{auth.verificationBusy ? 'Pairing…' : 'Connect OPTRANE Command'}</button>
          </form>
        </> : <>
          <p className="auth-description">Sign in with your OPTRANE website email and password. Pair a device later from Settings if you need heartbeat registration.</p>
          <form className="auth-form" onSubmit={(event) => { event.preventDefault(); if (canSignIn) void signIn(); }}>
            <label htmlFor="signin-email">Email</label>
            <input id="signin-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@studio.com" disabled={auth.verificationBusy}/>
            <label htmlFor="signin-password">Password</label>
            <input id="signin-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Website password" disabled={auth.verificationBusy}/>
            <button type="submit" className="primary wide" disabled={!canSignIn}>{auth.verificationBusy ? 'Signing in…' : 'Sign in to OPTRANE Command'}</button>
          </form>
        </>}
        {(auth.verificationMessage || error) && <div className={`auth-message ${error ? 'error' : ''}`}>{error || auth.verificationMessage}</div>}
        <small className="auth-security">Sessions are stored in the OS keychain. The desktop never receives Parallel, Google Cloud, ClickHouse, MCP, or governance service credentials.</small>
      </div>
    </section>
  </div>;
}
