import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import logger from '../config/logger';

interface FeatureLimits {
  channels: number;
  messages: number;
  forms: number;
  aiAgents: number;
  teammates: number;
}

export const checkSubscriptionLimits = (feature: keyof FeatureLimits) => {
  return async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.organizationId) {
        res.status(400).json({ error: 'Organization context required' });
        return;
      }

      // Get organization with subscription
      const organization = await prisma.organization.findUnique({
        where: { id: req.organizationId },
        include: {
          subscription: {
            include: {
              plan: true,
            },
          },
        },
      });

      if (!organization || !organization.subscription) {
        res.status(403).json({ error: 'No active subscription found' });
        return;
      }

      const plan = organization.subscription.plan;
      const currentPeriod = new Date().toISOString().slice(0, 7); // YYYY-MM

      // Get current usage
      const usage = await prisma.usageTracking.findUnique({
        where: {
          subscriptionId_period: {
            subscriptionId: organization.subscription.id,
            period: currentPeriod,
          },
        },
      });

      // Check limits
      const limits: FeatureLimits = {
        channels: plan.channelsLimit,
        messages: plan.messagesLimit,
        forms: plan.formsLimit,
        aiAgents: plan.aiAgentsLimit,
        teammates: plan.teammatesLimit,
      };

      const usageMap: Record<keyof FeatureLimits, number> = {
        channels: usage?.channelsUsed || 0,
        messages: usage?.messagesUsed || 0,
        forms: usage?.formsUsed || 0,
        aiAgents: usage?.aiAgentsUsed || 0,
        teammates: usage?.teammatesUsed || 0,
      };

      const limit = limits[feature];
      const currentUsage = usageMap[feature];

      // -1 means unlimited (Enterprise plan)
      if (limit !== -1 && currentUsage >= limit) {
        res.status(403).json({
          error: `Subscription limit reached for ${feature}`,
          limit,
          current: currentUsage,
          plan: plan.name,
        });
        return;
      }

      next();
    } catch (error) {
      logger.error('Subscription limit check error:', error);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }
  };
};
