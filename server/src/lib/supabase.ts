import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Optional: without Supabase credentials the game still runs — match
 * persistence and the bits media API are simply disabled.
 */
export const supabase: SupabaseClient | null = (url && key)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ? createClient(url, key, { realtime: { transport: ws as any } })
  : null;

if (!supabase) {
  console.warn('[supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — match persistence and bits API disabled');
}
