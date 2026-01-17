import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { attachOrganization } from '../middleware/organization';
import { AuthRequest } from '../types';
import prisma from '../config/database';

const router = Router();

router.use(authenticate);
router.use(attachOrganization);

// Get analytics overview
router.get('/overview', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { startDate, endDate } = req.query;
    
    const dateFilter: any = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.gte = new Date(startDate as string);
      if (endDate) dateFilter.createdAt.lte = new Date(endDate as string);
    }

    // 1. Tickets by Status
    const statusGroups = await prisma.ticket.groupBy({
      by: ['status'],
      where: {
        organizationId: req.organizationId,
        ...dateFilter,
      },
      _count: { _all: true },
    });

    const ticketsByStatus = {
      open: 0,
      in_progress: 0,
      closed: 0,
    };

    let totalTickets = 0;
    statusGroups.forEach((group) => {
      const status = group.status as keyof typeof ticketsByStatus;
      if (status in ticketsByStatus) {
        ticketsByStatus[status] = group._count._all;
      }
      totalTickets += group._count._all;
    });

    // 2. Tickets by Priority
    const priorityGroups = await prisma.ticket.groupBy({
      by: ['priority'],
      where: {
        organizationId: req.organizationId,
        ...dateFilter,
      },
      _count: { _all: true },
    });

    const ticketsByPriority = {
      low: 0,
      medium: 0,
      high: 0,
      urgent: 0,
    };

    priorityGroups.forEach((group) => {
      const priority = group.priority as keyof typeof ticketsByPriority;
      if (priority in ticketsByPriority) {
        ticketsByPriority[priority] = group._count._all;
      }
    });

    // 3. Tickets by Source
    const sourceGroups = await prisma.ticket.groupBy({
      by: ['sourceId'],
      where: {
        organizationId: req.organizationId,
        ...dateFilter,
        sourceId: { not: null },
      },
      _count: { _all: true },
    });

    const ticketsBySource: Record<string, number> = {};
    // We might want to resolve source names here, but for now using ID or mapping if possible
    // Ideally we join with SourceConnection but groupBy doesn't support include.
    // For now, key is sourceId. Frontend might need to map it.
    // Optimization: Fetch source types if needed.
    // Assuming sourceId is the integration type/name or we just return ID.
    // Schema says sourceId is String? @map("source_id").
    
    // Let's attempt to map source IDs to types if they are IDs. 
    // Or if sourceId IS the type (e.g. 'email', 'slack'). 
    // Based on integrations.ts, sourceId seems to be external ID. 
    // SourceConnection has sourceId and sourceType.
    // Ticket model has sourceId. Is it FK to SourceConnection? No relation defined in schema.
    
    // Simplification: Return grouping by sourceId.
    sourceGroups.forEach((group) => {
      if (group.sourceId) {
        ticketsBySource[group.sourceId] = group._count._all;
      }
    });

    // 4. Avg Resolution Time (for closed tickets)
    const closedTickets = await prisma.ticket.findMany({
      where: {
        organizationId: req.organizationId,
        status: 'closed',
        closedAt: { not: null },
        ...dateFilter,
      },
      select: {
        createdAt: true,
        closedAt: true,
      },
    });

    let totalResolutionTime = 0;
    closedTickets.forEach((ticket) => {
      if (ticket.closedAt) {
        const diff = new Date(ticket.closedAt).getTime() - new Date(ticket.createdAt).getTime();
        totalResolutionTime += diff;
      }
    });

    const avgResolutionTime = closedTickets.length > 0 
      ? (totalResolutionTime / closedTickets.length) / (1000 * 60) // in minutes
      : 0;

    // 5. Avg Response Time (Mocked/Simplified for now)
    // Real impl would need TicketMessage analysis
    const avgResponseTime = 0; 

    res.json({
      totalTickets,
      openTickets: ticketsByStatus.open,
      closedTickets: ticketsByStatus.closed,
      avgResponseTime,
      avgResolutionTime,
      ticketsByStatus,
      ticketsByPriority,
      ticketsBySource,
    });
  } catch (error) {
    next(error);
  }
});

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
