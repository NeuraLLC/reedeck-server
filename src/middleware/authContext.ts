import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to create an async context for each request
 * Simplified version - RLS is now handled by Supabase Auth natively
 */
export const authContextMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Pass through - Supabase handles RLS via JWT tokens
  next();
};

/**
 * Set the user ID in the current async context
 * No-op now that we're using Supabase's native RLS
 */
export function setAuthUserId(userId: string): void {
  // No-op - Supabase handles this automatically
}
