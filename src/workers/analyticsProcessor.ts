import { Job } from 'bull';
import { analyticsQueue } from '../config/queue';
import prisma from '../config/database';
import logger from '../config/logger';

interface AnalyticsAggregationJob {
  organizationId: string;
  type: 'daily' | 'weekly' | 'monthly';
}

/**
 * Aggregate analytics data
 * This runs periodically to compute expensive analytics
 */
analyticsQueue.process(async (job: Job<AnalyticsAggregationJob>) => {
  const { organizationId, type } = job.data;

  logger.info(`Aggregating ${type} analytics for organization ${organizationId}`);

  try {
    const now = new Date();
    let startDate: Date;

    // Determine time range
    switch (type) {
      case 'daily':
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 1);
        break;
      case 'weekly':
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'monthly':
        startDate = new Date(now);
        startDate.setMonth(startDate.getMonth() - 1);
        break;
    }

    // Aggregate ticket statistics
    const [totalTickets, openTickets, closedTickets, inProgressTickets] = await Promise.all([
      prisma.ticket.count({
        where: {
          organizationId,
          createdAt: { gte: startDate },
        },
      }),
      prisma.ticket.count({
        where: {
          organizationId,
          status: 'open',
          createdAt: { gte: startDate },
        },
      }),
      prisma.ticket.count({
        where: {
          organizationId,
          status: 'closed',
          createdAt: { gte: startDate },
        },
      }),
      prisma.ticket.count({
        where: {
          organizationId,
          status: 'in_progress',
          createdAt: { gte: startDate },
        },
      }),
    ]);

    // Calculate average resolution time
    const closedTicketsWithTimes = await prisma.ticket.findMany({
      where: {
        organizationId,
        status: 'closed',
        createdAt: { gte: startDate },
        closedAt: { not: null },
      },
      select: {
        createdAt: true,
        closedAt: true,
      },
    });

    const avgResolutionTime =
      closedTicketsWithTimes.length > 0
        ? closedTicketsWithTimes.reduce((sum, ticket) => {
            const resolutionTime =
              (ticket.closedAt!.getTime() - ticket.createdAt.getTime()) / (1000 * 60 * 60); // hours
            return sum + resolutionTime;
          }, 0) / closedTicketsWithTimes.length
        : 0;

    // Get AI automation stats
    const aiResolvedTickets = await prisma.ticket.count({
      where: {
        organizationId,
        status: 'closed',
        assignedTo: null, // Tickets closed without human assignment
        createdAt: { gte: startDate },
      },
    });

    const automationRate = totalTickets > 0 ? (aiResolvedTickets / totalTickets) * 100 : 0;

    const analytics = {
      organizationId,
      period: type,
      startDate,
      endDate: now,
      totalTickets,
      openTickets,
      closedTickets,
      inProgressTickets,
      avgResolutionTimeHours: avgResolutionTime,
      aiResolvedTickets,
      automationRate,
    };

    logger.info(`${type} analytics aggregated for organization ${organizationId}: ${totalTickets} tickets`);

    // TODO: Store aggregated data in a separate analytics table for faster queries
    // await prisma.analyticsSnapshot.create({ data: analytics });

    return {
      success: true,
      analytics,
    };
  } catch (error) {
    logger.error(`Error aggregating analytics for organization ${organizationId}:`, error);
    throw error;
  }
});

// Error handler
analyticsQueue.on('error', (error) => {
  logger.error('Analytics queue error:', error);
});

// Failed job handler
analyticsQueue.on('failed', (job, error) => {
  logger.error(`Analytics job ${job.id} failed:`, error);
});

// Completed job handler
analyticsQueue.on('completed', (job, result) => {
  logger.info(`Analytics job ${job.id} completed: ${result.analytics.totalTickets} tickets processed`);
});

logger.info('Analytics aggregation worker started');

export default analyticsQueue;
