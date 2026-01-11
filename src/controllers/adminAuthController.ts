import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import logger from '../config/logger';

export const adminLogin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError('Email and password are required', 400);
    }

    // Sign in with Supabase
    const { data: signInData, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      logger.error('Admin login error:', signInError);
      
      // Specifically handle unconfirmed email
      if ((signInError as any).code === 'email_not_confirmed' || signInError.message.includes('Email not confirmed')) {
        res.status(400).json({
          error: 'Email not confirmed',
          code: 'email_not_confirmed'
        });
        return;
      }
      
      throw new AppError('Invalid email or password', 401);
    }

    if (!signInData.session) {
      throw new AppError('Invalid email or password', 401);
    }

    // Check if user is super admin
    const user = await prisma.user.findUnique({
      where: { id: signInData.user.id },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (!user.isSuperAdmin) {
      throw new AppError('Access denied. Admin privileges required.', 403);
    }

    res.json({
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (error) {
    logger.error('Admin login error:', error);
    next(error);
  }
};

export const resendConfirmationEmail = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new AppError('Email is required', 400);
    }

    const { error } = await supabaseAdmin.auth.resend({
      type: 'signup',
      email,
    });

    if (error) {
      logger.error('Resend confirmation error:', error);
      throw new AppError(error.message, 400);
    }

    res.json({ message: 'Confirmation email resent successfully' });
  } catch (error) {
    next(error);
  }
};
