import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

type Mode = 'login' | 'register' | 'reset';

/**
 * Lovable route: /auth
 * Human accounts live here. OPTRANE Command never asks the user for a password.
 */
export default function AuthPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const safeReturnTo = useMemo(() => {
    const raw = params.get('returnTo') ?? '/';
    return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  }, [params]);
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (safeReturnTo === '/') return;
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.assign(safeReturnTo);
    });
  }, [safeReturnTo]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage('');
    try {
      if (mode === 'login') {
        const response = await fetch('/api/public/itrain-api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.message ?? 'Login failed');
        const value = payload?.data ?? payload;
        const { error } = await supabase.auth.setSession({
          access_token: value.accessToken ?? value.access_token,
          refresh_token: value.refreshToken ?? value.refresh_token,
        });
        if (error) throw error;
        window.location.assign(safeReturnTo);
        return;
      }
      if (mode === 'register') {
        const response = await fetch('/api/public/itrain-api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, displayName: displayName.trim() || undefined, returnTo: safeReturnTo }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.message ?? 'Registration failed');
        const value = payload?.data ?? payload;
        if (value.verificationRequired !== false) setMessage('Account created. Verify your email, then return to this page to sign in and approve OPTRANE Command.');
        else setMessage('Account created. Sign in to continue.');
        setMode('login');
        return;
      }
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth?returnTo=${encodeURIComponent(safeReturnTo)}`,
      });
      if (error) throw error;
      setMessage('Password-reset instructions were sent to your email.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Authentication failed.');
    } finally { setBusy(false); }
  }

  return <main className="optrane-auth-page">
    <section className="optrane-auth-card">
      <span>OPTRANE</span>
      <h1>{mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Reset password'}</h1>
      <p>Your OPTRANE website account is the only human identity used by OPTRANE Command. Desktop verification happens after this step.</p>
      <form onSubmit={submit}>
        {mode === 'register' && <label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name"/></label>}
        <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"/></label>
        {mode !== 'reset' && <label>Password<input type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'}/></label>}
        <button disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create & verify account' : 'Send reset email'}</button>
      </form>
      {message && <small>{message}</small>}
      <nav>
        {mode !== 'login' && <button type="button" onClick={() => { setMode('login'); setMessage(''); }}>Sign in</button>}
        {mode !== 'register' && <button type="button" onClick={() => { setMode('register'); setMessage(''); }}>Create account</button>}
        {mode !== 'reset' && <button type="button" onClick={() => { setMode('reset'); setMessage(''); }}>Forgot password?</button>}
      </nav>
      <aside>Passwords and email verification stay on the OPTRANE website. The desktop receives only a short-lived one-time pairing callback and exchanges it for a normal user session.</aside>
    </section>
  </main>;
}
