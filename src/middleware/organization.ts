import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import logger from '../config/logger';

export const attachOrganization = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    // Get organization from header or query parameter
    const orgId = req.headers['x-organization-id'] as string || req.query.organizationId as string;

    if (!orgId) {
      res.status(400).json({ error: 'Organization ID is required' });
      return;
    }

    // Verify user belongs to this organization
    const membership = await prisma.organizationMember.findFirst({
      where: {
        userId: req.userId,
        organizationId: orgId,
        status: 'active',
      },
    });

    if (!membership) {
      res.status(403).json({ error: 'Access denied to this organization' });
      return;
    }

    req.organizationId = orgId;
    req.userRole = membership.role;
    next();
  } catch (error) {
    logger.error('Organization attachment error:', error);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
};

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  if (req.userRole !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
};
