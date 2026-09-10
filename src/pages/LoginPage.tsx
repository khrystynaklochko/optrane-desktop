import { useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { cancelWebsiteVerification } from '../api/browserAuth';
import { probeGatewayPairing } from '../api/gateway';
import {
  formatPairingCodeInput,
  isCompletePairingCode,
  LEGACY_PAIRING_WEBSITE,
} from '../api/legacyPairing';
import { getOptraneWebBase } from '../config/optrane';
import { useAuthState } from '../state/AuthState';

function inTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function LoginPage() {
  const auth = useAuthState();
  const [error, setError] = useState('');
  const [pairingCode, setPairingCode] = useState('');

  useEffect(() => {
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
    try {
      await auth.claimPairingCode(normalizedCode);
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
  const canConnect = isCompletePairingCode(pairingCode) && !auth.verificationBusy;

  return <div className="auth-shell">
    <section className="auth-visual">
      <div className="auth-brand"><div className="brand-mark large">O</div><div><b>OPTRANE</b><span>Autonomous Operations</span></div></div>
      <div className="auth-copy">
        <span className="eyebrow">DESKTOP CONTROL SYSTEM</span>
        <h1>One verified account.<br/>One governed gateway.<br/>No service secrets.</h1>
        <p>Sign in on the hosted OPTRANE website, copy your pairing code, and connect this desktop in one step.</p>
      </div>
      <div className="auth-stack">
        <div><span>ACCOUNT</span><b>OPTRANE Website</b></div><i>→</i><div><span>PAIRING CODE</span><b>XXXX-XXXX</b></div><i>→</i><div><span>GATEWAY</span><b>Lovable API</b></div>
      </div>
    </section>
    <section className="auth-panel">
      <div className="auth-card">
        <span className="eyebrow">SECURE DESKTOP PAIRING</span>
        <h2>Connect OPTRANE Command</h2>
        <p className="auth-description">Open <b>{websiteHost}</b>, sign in, and copy the pairing code shown for this device. Paste it below exactly as displayed, including the hyphen.</p>
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
            placeholder="CQN9-Q4JZ"
            disabled={auth.verificationBusy}
            onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
            onBlur={() => setPairingCode((current) => formatPairingCodeInput(current))}
            onPaste={(event) => {
              event.preventDefault();
              setPairingCode(formatPairingCodeInput(event.clipboardData.getData('text')));
            }}
          />
          <button type="submit" className="primary wide" disabled={!canConnect}>{auth.verificationBusy ? 'Pairing…' : 'Connect OPTRANE Command'}</button>
        </form>
        {!canConnect && pairingCode.trim() && !auth.verificationBusy && (
          <small className="auth-hint">Enter all 8 characters — with or without the hyphen (e.g. CQN9-Q4JZ).</small>
        )}
        {(auth.verificationMessage || error) && <div className={`auth-message ${error ? 'error' : ''}`}>{error || auth.verificationMessage}</div>}
        <small className="auth-security">The device token is stored in the OS keychain. The desktop never receives Parallel, Google Cloud, ClickHouse, MCP, or governance service credentials.</small>
      </div>
    </section>
  </div>;
}
