import { useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { cancelWebsiteVerification } from '../api/browserAuth';
import { probeGatewayPairing } from '../api/gateway';
import {
  formatPairingCodeInput,
  isCompletePairingCode,
  LEGACY_PAIRING_WEBSITE,
} from '../api/legacyPairing';
import { getOptraneApiBase, getOptraneWebBase, setOptraneApiEnvironment } from '../config/optrane';
import { useAuthState } from '../state/AuthState';

function inTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function LoginPage() {
  const auth = useAuthState();
  const [error, setError] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    setOptraneApiEnvironment('production');
    void probeGatewayPairing().then(() => cancelWebsiteVerification()).catch(() => cancelWebsiteVerification());
  }, []);

  const claim = async () => {
    setError('');
    const normalizedCode = formatPairingCodeInput(pairingCode);
    setPairingCode(normalizedCode);
    if (!isCompletePairingCode(normalizedCode)) {
      setError('Enter the full pairing code from the website (format XXXX-XXXX).');
      return;
    }
    if (password.length < 8) {
      setError('Enter the same password you use on the OPTRANE website.');
      return;
    }
    try {
      await auth.claimPairingCode(normalizedCode, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not claim the pairing code');
    }
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
  const canConnect = isCompletePairingCode(pairingCode) && password.length >= 8 && !auth.verificationBusy;

  return <div className="auth-shell">
    <section className="auth-visual">
      <div className="auth-brand"><div className="brand-mark large">O</div><div><b>OPTRANE</b><span>Autonomous Operations</span></div></div>
      <div className="auth-copy">
        <span className="eyebrow">DESKTOP CONTROL SYSTEM</span>
        <h1>One verified account.<br/>One governed gateway.<br/>No service secrets.</h1>
        <p>Get a pairing code on the hosted OPTRANE website, then connect this desktop with that code and your website password.</p>
      </div>
      <div className="auth-stack">
        <div><span>ACCOUNT</span><b>OPTRANE Website</b></div><i>→</i><div><span>PAIRING CODE</span><b>XXXX-XXXX</b></div><i>→</i><div><span>GATEWAY</span><b>Lovable API</b></div>
      </div>
    </section>
    <section className="auth-panel">
      <div className="auth-card">
        <span className="eyebrow">SECURE DESKTOP PAIRING</span>
        <h2>Connect OPTRANE Command</h2>
        <p className="auth-description">Open <b>{websiteHost}</b>, sign in, and copy the pairing code for this device. Each code works once — generate a new one if you already tried it.</p>
        <button type="button" className="ghost wide" disabled={auth.verificationBusy} onClick={() => void openWebsite()}>Open OPTRANE website</button>
        <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void claim(); }}>
          <label htmlFor="pairing-code">Pairing code</label>
          <input
            id="pairing-code"
            className="pairing-code-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            value={pairingCode}
            placeholder="JF6F-6828"
            disabled={auth.verificationBusy}
            onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
            onBlur={() => setPairingCode((current) => formatPairingCodeInput(current))}
            onPaste={(event) => {
              event.preventDefault();
              setPairingCode(formatPairingCodeInput(event.clipboardData.getData('text')));
            }}
          />
          <label htmlFor="pair-password">Website password</label>
          <input
            id="pair-password"
            type="password"
            autoComplete="current-password"
            value={password}
            placeholder="Same password as the OPTRANE website"
            disabled={auth.verificationBusy}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button type="submit" className="primary wide" disabled={!canConnect}>{auth.verificationBusy ? 'Pairing…' : 'Connect OPTRANE Command'}</button>
        </form>
        {!canConnect && pairingCode.trim() && !auth.verificationBusy && (
          <small className="auth-hint">Enter the full pairing code and your website password to enable Connect.</small>
        )}
        {(auth.verificationMessage || error) && <div className={`auth-message ${error ? 'error' : ''}`}>{error || auth.verificationMessage}</div>}
        <small className="auth-gateway-note">Gateway: {getOptraneApiBase()}</small>
        <small className="auth-security">The device token is stored in the OS keychain. The desktop never receives Parallel, Google Cloud, ClickHouse, MCP, or governance service credentials.</small>
      </div>
    </section>
  </div>;
}
