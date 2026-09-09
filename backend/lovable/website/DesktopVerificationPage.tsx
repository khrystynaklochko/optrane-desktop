import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } },
);

/**
 * Lovable route: /desktop/verify
 *
 * This page is intentionally the human trust boundary for OPTRANE Command.
 * It does not hand service credentials to the desktop. It only approves a
 * short-lived desktop-auth request after the user has a verified OPTRANE website session.
 */
export default function DesktopVerificationPage() {
  const requestId = useMemo(() => new URLSearchParams(window.location.search).get('request_id') ?? '', []);
  const [sessionReady, setSessionReady] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? '');
      setSessionReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setEmail(session?.user.email ?? ''));
    return () => data.subscription.unsubscribe();
  }, []);

  async function approve() {
    if (!requestId) return setMessage('The desktop verification request is missing. Start again from OPTRANE Command.');
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/auth?returnTo=${returnTo}`;
      return;
    }
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/public/itrain-api/desktop-auth/${encodeURIComponent(requestId)}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message ?? payload?.detail ?? 'Could not approve desktop session');
      const value = payload?.data ?? payload;
      setApproved(true);
      setMessage('Account verified. Returning to OPTRANE Command…');
      window.setTimeout(() => { window.location.href = value.callbackUri ?? value.callback_uri ?? `optrane://auth/callback?request_id=${encodeURIComponent(requestId)}`; }, 350);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not verify the desktop session');
    } finally { setBusy(false); }
  }

  if (!sessionReady) return <main className="desktop-verify"><h1>OPTRANE</h1><p>Checking your account…</p></main>;

  return <main className="desktop-verify">
    <section>
      <span>OPTRANE COMMAND</span>
      <h1>{approved ? 'Desktop verified.' : 'Verify this desktop.'}</h1>
      <p>{email ? <>You are signed in as <b>{email}</b>. Approve this request to establish an OPTRANE desktop session through the gateway.</> : <>Sign in or create your OPTRANE account before approving this desktop.</>}</p>
      {email ? <button disabled={busy || approved} onClick={() => void approve()}>{busy ? 'Verifying…' : approved ? 'Verified' : 'Verify OPTRANE Command'}</button> : <button onClick={() => { const returnTo = encodeURIComponent(window.location.pathname + window.location.search); window.location.href = `/auth?returnTo=${returnTo}`; }}>Sign in to OPTRANE</button>}
      {message && <small>{message}</small>}
      <aside>OPTRANE Command receives only your OPTRANE user session. Governance-provider, Google Cloud, ClickHouse, MCP, peer-signing, service-role and other private credentials remain on the Lovable backend.</aside>
    </section>
  </main>;
}
