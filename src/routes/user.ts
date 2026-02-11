import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

const router = Router();

router.use(authenticate);

// Get user profile
router.get('/profile', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        telegramUsername: true,
        discordId: true,
        slackId: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    res.json(user);
  } catch (error) {
    next(error);
  }
});

// Update user profile
router.patch('/profile', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { firstName, lastName, telegramUsername, discordId, slackId } = req.body;

    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(telegramUsername !== undefined && { telegramUsername }),
        ...(discordId !== undefined && { discordId }),
        ...(slackId !== undefined && { slackId }),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        telegramUsername: true,
        discordId: true,
        slackId: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// Upload avatar
router.post('/profile/avatar', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { avatarUrl } = req.body;

    if (!avatarUrl) {
      throw new AppError('Avatar URL is required', 400);
    }

    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: { avatarUrl },
      select: {
        id: true,
        avatarUrl: true,
      },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

export default router;
