import { createClient } from 'npm:@supabase/supabase-js@2';
import { env } from './env.ts';
import { HttpError } from './http.ts';

export function publicAuthClient() {
  if (!env.supabaseUrl || !env.supabaseAnonKey) throw new Error('SUPABASE_ANON_KEY is required for OPTRANE authentication');
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function consumeMagicLinkToken(tokenHash: string) {
  const client = publicAuthClient();
  const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (error || !data.session) throw new HttpError(401, error?.message ?? 'Desktop session token could not be consumed', 'desktop_session_exchange_failed');
  return data;
}
