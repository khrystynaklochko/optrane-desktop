export type OptraneEnvironment = 'production' | 'preview' | 'custom';

export const OPTRANE_PRODUCTION_BASE = 'https://film-sparkle-layer.lovable.app';
export const OPTRANE_PREVIEW_BASE = 'https://project--309e6175-07ff-41df-81c3-16d713bb13e2-dev.lovable.app';

export const OPTRANE_PUBLIC_API_PREFIX = (import.meta.env.VITE_OPTRANE_API_PREFIX ?? '/api/public/itrain-api').replace(/\/$/, '');
export const OPTRANE_DESKTOP_CALLBACK = import.meta.env.VITE_OPTRANE_DESKTOP_CALLBACK ?? 'optrane://auth/callback';

export const OPTRANE_GATEWAY_PUBLISHABLE_KEY = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  ?? import.meta.env.VITE_SUPABASE_ANON_KEY
  ?? 'sb_publishable_tR-JmlGTCrr7ix7PxBXymQ_G-AQ8eMj'
).trim();

export const OPTRANE_SUPABASE_URL = (
  import.meta.env.VITE_SUPABASE_URL
  ?? 'https://jlcbbwakkvfhfbeheldv.supabase.co'
).replace(/\/$/, '');

const RUNTIME_ENV_KEY = 'optrane.api.env';

export function getOptraneApiEnvironment(): OptraneEnvironment {
  if (import.meta.env.VITE_OPTRANE_API_BASE || import.meta.env.VITE_OPTRANE_WEB_BASE) return 'custom';
  const runtime = typeof localStorage !== 'undefined' ? localStorage.getItem(RUNTIME_ENV_KEY) : null;
  if (runtime === 'preview' || runtime === 'production') return runtime;
  const env = import.meta.env.VITE_OPTRANE_ENV;
  if (env === 'preview' || env === 'production') return env;
  return 'production';
}

export function setOptraneApiEnvironment(env: 'production' | 'preview') {
  localStorage.setItem(RUNTIME_ENV_KEY, env);
}

export function getOptraneWebBase(): string {
  if (import.meta.env.VITE_OPTRANE_WEB_BASE) {
    return import.meta.env.VITE_OPTRANE_WEB_BASE.replace(/\/$/, '');
  }
  const env = getOptraneApiEnvironment();
  return (env === 'preview' ? OPTRANE_PREVIEW_BASE : OPTRANE_PRODUCTION_BASE).replace(/\/$/, '');
}

export function getOptraneApiBase(): string {
  if (import.meta.env.VITE_OPTRANE_API_BASE) {
    return import.meta.env.VITE_OPTRANE_API_BASE.replace(/\/$/, '');
  }
  return `${getOptraneWebBase()}${OPTRANE_PUBLIC_API_PREFIX}`;
}

export function getOptraneDesktopVerifyUrl(): string {
  return (
    import.meta.env.VITE_OPTRANE_DESKTOP_VERIFY_URL
    ?? `${getOptraneWebBase()}/desktop/verify`
  ).replace(/\/$/, '');
}

/** @deprecated use getOptraneWebBase() for runtime-aware base URL */
export const OPTRANE_WEB_BASE = getOptraneWebBase();
/** @deprecated use getOptraneApiBase() for runtime-aware API URL */
export const OPTRANE_API_BASE = getOptraneApiBase();
export const OPTRANE_DESKTOP_VERIFY_URL = getOptraneDesktopVerifyUrl();
