import { Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase';
import prisma from '../config/database';
import { AppError } from './errorHandler';
import { AuthRequest } from '../types';

export const adminAuthenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('No token provided', 401);
    }

    const token = authHeader.substring(7);

    // Verify token with Supabase
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data.user) {
      throw new AppError('Invalid token', 401);
    }

    // Get user from database and check if super admin
    const user = await prisma.user.findUnique({
      where: { id: data.user.id },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (!user.isSuperAdmin) {
      throw new AppError('Access denied. Admin privileges required.', 403);
    }

    req.userId = user.id;
    next();
  } catch (error) {
    next(error);
  }
};
