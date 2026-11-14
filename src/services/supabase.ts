import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || '';
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || '';

export const supabaseConfigurationStatus = {
  urlPresent: Boolean(supabaseUrl),
  publishableKeyPresent: Boolean(publishableKey),
};

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && publishableKey);
}

let client: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
  }
  if (client) return client;
  client = createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      flowType: 'pkce',
    },
  });
  return client;
}
