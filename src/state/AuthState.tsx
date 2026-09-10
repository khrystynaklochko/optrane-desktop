import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as deepLink from '@tauri-apps/plugin-deep-link';
import {
  completeWebsiteVerification,
  pendingWebsiteVerification,
  startWebsiteVerification,
  type DesktopAuthStart,
} from '../api/browserAuth';
import { claimPairingCode } from '../api/legacyPairing';
import {
  getDesktopSession,
  onDesktopSessionCleared,
  setDesktopSession,
  setLegacyPairingSession,
  signOutDesktop,
  validateDesktopSession,
  type DesktopSession,
  type DesktopUser,
} from '../api/session';

type AuthMode = 'website';

interface AuthStateValue {
  ready: boolean;
  session: DesktopSession | null;
  user: DesktopUser | null;
  mode: AuthMode;
  verification: DesktopAuthStart | null;
  verificationBusy: boolean;
  verificationMessage: string;
  verifyOnWebsite: () => Promise<void>;
  finishWebsiteVerification: (requestId?: string) => Promise<void>;
  claimPairingCode: (code: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  startAnonymousDemo: () => Promise<void>;
  sendEmailOtp: (email: string) => Promise<void>;
  verifyEmailOtp: (email: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthStateContext = createContext<AuthStateValue | null>(null);

function authRequestId(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'optrane:' || url.hostname !== 'auth' || !url.pathname.includes('callback')) return undefined;
    return url.searchParams.get('request_id') ?? url.searchParams.get('requestId') ?? undefined;
  } catch { return undefined; }
}

export function AuthStateProvider({ children }: { children: ReactNode }) {
  const mode: AuthMode = 'website';
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<DesktopSession | null>(null);
  const [verification, setVerification] = useState<DesktopAuthStart | null>(() => pendingWebsiteVerification());
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState('');

  const finishWebsiteVerification = useCallback(async (requestId?: string) => {
    setVerificationBusy(true);
    setVerificationMessage('Confirming the verified OPTRANE website session…');
    try {
      await completeWebsiteVerification(requestId);
      const verified = await getDesktopSession();
      if (!verified) throw new Error('OPTRANE did not persist the verified desktop session.');
      setSession(verified);
      setVerification(null);
      setVerificationMessage('Account verified. OPTRANE Command is connected.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not finish website verification';
      setVerificationMessage(message);
      throw error;
    } finally { setVerificationBusy(false); }
  }, []);

  useEffect(() => {
    let alive = true;
    void validateDesktopSession().then((validated) => {
      if (!alive) return;
      setSession(validated);
      setReady(true);
    }).catch(() => {
      if (alive) { setSession(null); setReady(true); }
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => onDesktopSessionCleared(() => setSession(null)), []);

  // Authentication deep links are handled before the production shell mounts.
  // They carry only a request identifier; the verifier stays on this device and
  // access/refresh credentials are returned only by the OPTRANE gateway exchange.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const handle = (urls: string[]) => {
      const requestId = urls.map(authRequestId).find(Boolean);
      if (requestId) void finishWebsiteVerification(requestId).catch(() => undefined);
    };
    const module = deepLink as unknown as {
      getCurrent?: () => Promise<string[] | null>;
      onOpenUrl: (callback: (urls: string[]) => void) => Promise<() => void>;
    };
    module.getCurrent?.().then((urls) => urls && handle(urls)).catch(() => undefined);
    module.onOpenUrl(handle).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
  }, [finishWebsiteVerification]);

  const claimPairingCodeOnDevice = useCallback(async (code: string, password: string) => {
    setVerificationBusy(true);
    setVerificationMessage('Claiming the OPTRANE pairing code…');
    try {
      const claim = await claimPairingCode(code, password);
      const verified = await setLegacyPairingSession(claim);
      setSession(verified);
      setVerification(null);
      setVerificationMessage('OPTRANE Command is paired with your account.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not claim the pairing code';
      setVerificationMessage(message);
      throw error;
    } finally { setVerificationBusy(false); }
  }, []);

  const verifyOnWebsite = useCallback(async () => {
    setVerificationBusy(true);
    setVerificationMessage('Opening the secure OPTRANE account website…');
    try {
      const request = await startWebsiteVerification();
      setVerification(request);
      setVerificationMessage('Sign in or create and verify your account in the browser. OPTRANE Command reconnects automatically.');
    } catch (error) {
      setVerificationMessage(error instanceof Error ? error.message : 'Could not open website verification');
      throw error;
    } finally { setVerificationBusy(false); }
  }, []);

  const desktopOnlyError = () => Promise.reject(new Error('OPTRANE Command does not collect account credentials. Sign in or register on the OPTRANE website.'));
  const signIn = useCallback(async (_email: string, _password: string) => { await desktopOnlyError(); }, []);
  const signUp = useCallback(async (_email: string, _password: string) => { await desktopOnlyError(); return { needsConfirmation: true }; }, []);
  const startAnonymousDemo = useCallback(async () => { throw new Error('Anonymous desktop authentication is disabled. Use the OPTRANE website verification flow.'); }, []);
  const sendEmailOtp = useCallback(async (_email: string) => { await desktopOnlyError(); }, []);
  const verifyEmailOtp = useCallback(async (_email: string, _token: string) => { await desktopOnlyError(); }, []);

  const signOut = useCallback(async () => {
    await signOutDesktop();
    setSession(null);
  }, []);

  const value = useMemo<AuthStateValue>(() => ({
    ready,
    session,
    user: session?.user ?? null,
    mode,
    verification,
    verificationBusy,
    verificationMessage,
    verifyOnWebsite,
    finishWebsiteVerification,
    claimPairingCode: claimPairingCodeOnDevice,
    signIn,
    signUp,
    startAnonymousDemo,
    sendEmailOtp,
    verifyEmailOtp,
    signOut,
  }), [ready, session, verification, verificationBusy, verificationMessage, verifyOnWebsite, finishWebsiteVerification, claimPairingCodeOnDevice, signIn, signUp, startAnonymousDemo, sendEmailOtp, verifyEmailOtp, signOut]);

  return <AuthStateContext.Provider value={value}>{children}</AuthStateContext.Provider>;
}

export function useAuthState(): AuthStateValue {
  const value = useContext(AuthStateContext);
  if (!value) throw new Error('useAuthState must be used inside AuthStateProvider');
  return value;
}
