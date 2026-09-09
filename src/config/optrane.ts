export type OptraneEnvironment = 'production' | 'custom';

// Canonical OPTRANE Lovable website + public gateway.
// The desktop talks only to this origin unless an explicit VITE_OPTRANE_WEB_BASE
// override is provided for a controlled staging deployment.
export const OPTRANE_PRODUCTION_BASE = 'https://film-sparkle-layer.lovable.app';

export const OPTRANE_WEB_BASE = (
  import.meta.env.VITE_OPTRANE_WEB_BASE
  ?? OPTRANE_PRODUCTION_BASE
).replace(/\/$/, '');

// Keep the deployed Lovable compatibility namespace exactly as exposed today.
// Product branding is OPTRANE; only the gateway path retains the historical
// /itrain-api name until the Lovable route is migrated server-side.
export const OPTRANE_PUBLIC_API_PREFIX = (import.meta.env.VITE_OPTRANE_API_PREFIX ?? '/api/public/itrain-api').replace(/\/$/, '');
export const OPTRANE_API_BASE = (import.meta.env.VITE_OPTRANE_API_BASE ?? `${OPTRANE_WEB_BASE}${OPTRANE_PUBLIC_API_PREFIX}`).replace(/\/$/, '');

export const OPTRANE_DESKTOP_VERIFY_URL = (
  import.meta.env.VITE_OPTRANE_DESKTOP_VERIFY_URL
  ?? `${OPTRANE_WEB_BASE}/desktop/verify`
).replace(/\/$/, '');

export const OPTRANE_DESKTOP_CALLBACK = import.meta.env.VITE_OPTRANE_DESKTOP_CALLBACK ?? 'optrane://auth/callback';

// Publishable Supabase key for the Lovable gateway edge proxy. This is already
// public on the OPTRANE website bundle and is required to reach bootstrap routes
// such as /desktop-auth/start before a user session exists.
export const OPTRANE_GATEWAY_PUBLISHABLE_KEY = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  ?? import.meta.env.VITE_SUPABASE_ANON_KEY
  ?? 'sb_publishable_tR-JmlGTCrr7ix7PxBXymQ_G-AQ8eMj'
).trim();
