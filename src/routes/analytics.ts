import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { attachOrganization } from '../middleware/organization';
import { AuthRequest } from '../types';
import prisma from '../config/database';

const router = Router();

router.use(authenticate);
router.use(attachOrganization);

// Get dashboard analytics
router.get('/dashboard', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Get ticket counts by status
    const openTickets = await prisma.ticket.count({
      where: {
        organizationId: req.organizationId,
        status: 'open',
      },
    });

    const inProgressTickets = await prisma.ticket.count({
      where: {
        organizationId: req.organizationId,
        status: 'in_progress',
      },
    });

    const closedTickets = await prisma.ticket.count({
      where: {
        organizationId: req.organizationId,
        status: 'closed',
      },
    });

    const totalTickets = await prisma.ticket.count({
      where: {
        organizationId: req.organizationId,
      },
    });

    // Get message counts
    const totalMessages = await prisma.ticketMessage.count({
      where: {
        ticket: {
          organizationId: req.organizationId,
        },
      },
    });

    res.json({
      totalMessages,
      totalPendingMessages: openTickets,
      totalInProgressMessages: inProgressTickets,
      totalClosedMessages: closedTickets,
      totalTickets,
    });
  } catch (error) {
    next(error);
  }
});

// Get chart data
router.get('/chart', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { timeRange = 'week' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate = new Date();

    switch (timeRange) {
      case 'day':
        startDate.setDate(now.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
      default:
        startDate.setDate(now.getDate() - 7);
    }

    // Get tickets created in the time range
    const tickets = await prisma.ticket.findMany({
      where: {
        organizationId: req.organizationId,
        createdAt: {
          gte: startDate,
          lte: now,
        },
      },
      select: {
        createdAt: true,
        status: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    // Group by date
    const chartData = tickets.reduce((acc: any[], ticket) => {
      const date = ticket.createdAt.toISOString().split('T')[0];
      const existing = acc.find((item) => item.date === date);

      if (existing) {
        existing.value += 1;
      } else {
        acc.push({ date, value: 1 });
      }

      return acc;
    }, []);

    res.json({ data: chartData });
  } catch (error) {
    next(error);
  }
});

// Get message analytics
router.get('/messages', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, startDate, endDate } = req.query;

    const where: any = {
      organizationId: req.organizationId,
    };

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate as string);
      }
    }

    const messagesByStatus = await prisma.ticket.groupBy({
      by: ['status'],
      where,
      _count: {
        status: true,
      },
    });

    res.json(messagesByStatus);
  } catch (error) {
    next(error);
  }
});

export default router;
