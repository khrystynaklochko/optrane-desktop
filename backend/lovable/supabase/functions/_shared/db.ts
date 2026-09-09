import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { env, assertServerConfiguration } from './env.ts';

let singleton: SupabaseClient | null = null;

export function admin(): SupabaseClient {
  assertServerConfiguration();
  if (!singleton) {
    singleton = createClient(env.supabaseUrl, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return singleton;
}

export async function one<T>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>, label = 'database query'): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  if (data == null) throw new Error(`${label}: no data returned`);
  return data;
}

export async function many<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, label = 'database query'): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
}
