import { supabase } from './supabase.js';

/**
 * Progression helpers: XP, tickets (earnable currency), crowns (premium
 * currency). Nothing awards these yet — future rollouts (match rewards,
 * shops) call these functions instead of touching the database directly.
 *
 * All mutations go through atomic SQL functions (see migration 003), so
 * concurrent updates can't race and balances can never go negative.
 */

export interface PlayerProfile {
  id: string;
  username: string;
  avatar_url: string | null;
  level: number;
  xp: number;
  tickets: number;
  crowns: number;
  total_wins: number;
  total_matches: number;
  date_of_birth: string | null;
  created_at: string;
}

export class InsufficientBalanceError extends Error {
  constructor(public currency: 'tickets' | 'crowns') {
    super(`insufficient_${currency}`);
    this.name = 'InsufficientBalanceError';
  }
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase not configured — progression unavailable');
  return supabase;
}

async function rpcProfile(
  fn: 'add_xp' | 'adjust_tickets' | 'adjust_crowns',
  userId: string,
  amount: number
): Promise<PlayerProfile> {
  const args = fn === 'add_xp'
    ? { p_user_id: userId, p_amount: amount }
    : { p_user_id: userId, p_delta: amount };
  const { data, error } = await requireSupabase().rpc(fn, args);

  if (error) {
    if (error.message.includes('insufficient_tickets')) throw new InsufficientBalanceError('tickets');
    if (error.message.includes('insufficient_crowns')) throw new InsufficientBalanceError('crowns');
    throw new Error(`${fn} failed: ${error.message}`);
  }
  return data as PlayerProfile;
}

/**
 * Award XP and recompute the level (level = floor(sqrt(xp/100)) + 1).
 * Returns the updated profile plus whether this award leveled them up.
 */
export async function addXP(
  userId: string,
  amount: number
): Promise<{ profile: PlayerProfile; leveledUp: boolean }> {
  if (amount < 0) throw new Error('XP can only increase');

  const before = await getProfile(userId);
  const profile = await rpcProfile('add_xp', userId, amount);
  return { profile, leveledUp: profile.level > (before?.level ?? 1) };
}

/** Add tickets to a player's balance. */
export function addTickets(userId: string, amount: number): Promise<PlayerProfile> {
  if (amount < 0) throw new Error('Use removeTickets to spend');
  return rpcProfile('adjust_tickets', userId, amount);
}

/** Spend tickets. Throws InsufficientBalanceError rather than going negative. */
export function removeTickets(userId: string, amount: number): Promise<PlayerProfile> {
  if (amount < 0) throw new Error('Amount must be positive');
  return rpcProfile('adjust_tickets', userId, -amount);
}

/** Add crowns (premium currency — no payment integration yet). */
export function addCrowns(userId: string, amount: number): Promise<PlayerProfile> {
  if (amount < 0) throw new Error('Use removeCrowns to spend');
  return rpcProfile('adjust_crowns', userId, amount);
}

/** Spend crowns. Throws InsufficientBalanceError rather than going negative. */
export function removeCrowns(userId: string, amount: number): Promise<PlayerProfile> {
  if (amount < 0) throw new Error('Amount must be positive');
  return rpcProfile('adjust_crowns', userId, -amount);
}

/** Fetch a profile, or null if it doesn't exist. */
export async function getProfile(userId: string): Promise<PlayerProfile | null> {
  const { data, error } = await requireSupabase()
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`getProfile failed: ${error.message}`);
  return data as PlayerProfile | null;
}
