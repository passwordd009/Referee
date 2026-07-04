import type { Request, Response, NextFunction } from 'express';
import { supabase } from './supabase.js';

/**
 * Authentication middleware for API routes.
 *
 * Verifies the Supabase JWT from the Authorization header and puts the
 * verified user id on req.authUserId. Routes must use THAT id — never a
 * user id from the request body, which anyone could forge.
 */

declare module 'express-serve-static-core' {
  interface Request {
    authUserId?: string;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!supabase) {
    res.status(503).json({ error: 'Auth unavailable: Supabase not configured' });
    return;
  }

  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.authUserId = data.user.id;
  next();
}
