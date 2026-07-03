import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';

/**
 * Supabase is optional on the server — it only powers match history
 * persistence and the bits media API. When the env vars are missing
 * (e.g. local development), the game itself still runs; persistence
 * quietly becomes a no-op.
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseConfigured = Boolean(url && key);

if (!supabaseConfigured) {
  console.warn('[supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — match persistence and bits API disabled');
}

export const supabase: SupabaseClient | null = supabaseConfigured
  ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createClient(url!, key!, { realtime: { transport: ws as any } })
  : null;
