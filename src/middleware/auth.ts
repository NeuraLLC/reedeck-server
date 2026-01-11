import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import logger from '../config/logger';
import { supabaseAdmin } from '../config/supabase';
import { setAuthUserId } from './authContext';

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);

    try {
      // Verify token with Supabase
      const { data, error } = await supabaseAdmin.auth.getUser(token);

      if (error || !data.user) {
        logger.error('Supabase token verification failed:', error);
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }

      // Set user ID on request
      req.userId = data.user.id;

      // Set user ID in auth context for RLS
      setAuthUserId(data.user.id);

      next();
    } catch (error) {
      logger.error('Token verification failed:', error);
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
};
