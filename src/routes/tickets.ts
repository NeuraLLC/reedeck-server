import { Router } from 'express';
import { Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { attachOrganization } from '../middleware/organization';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { ticketProcessingQueue } from '../config/queue';
import { sendResponseToSource } from '../services/channelRelay';

const router = Router();

// Apply authentication and organization middleware to all routes
router.use(authenticate);
router.use(attachOrganization);

// Get all tickets for organization
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, priority, page = 1, limit = 20 } = req.query;

    const where: any = {
      organizationId: req.organizationId,
    };

    if (status) where.status = status;
    if (priority) where.priority = priority;

    const tickets = await prisma.ticket.findMany({
      where,
      include: {
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
        tags: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });

    const total = await prisma.ticket.count({ where });

    res.json({
      tickets,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get single ticket
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ticket = await prisma.ticket.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId,
      },
      include: {
        messages: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        tags: true,
      },
    });

    if (!ticket) {
      throw new AppError('Ticket not found', 404);
    }

    res.json(ticket);
  } catch (error) {
    next(error);
  }
});

// Create ticket
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { customerName, customerEmail, subject, priority, message } = req.body;

    const ticket = await prisma.ticket.create({
      data: {
        organizationId: req.organizationId!,
        customerName,
        customerEmail,
        subject,
        priority: priority || 'medium',
        status: 'open',
        messages: {
          create: {
            senderType: 'customer',
            content: message,
          },
        },
      },
      include: {
        messages: true,
      },
    });

    // Check if autonomous AI is enabled for this organization
    const organization = await prisma.organization.findUnique({
      where: { id: req.organizationId! },
      select: { settings: true },
    });

    const aiSettings = (organization?.settings as any)?.autonomousAI;

    // Trigger autonomous AI processing if enabled
    if (aiSettings?.enabled && aiSettings?.autoResponseEnabled) {
      ticketProcessingQueue.add({
        ticketId: ticket.id,
        organizationId: req.organizationId!,
      });
    }

    res.status(201).json(ticket);
  } catch (error) {
    next(error);
  }
});

// Update ticket
router.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status, priority, assignedTo } = req.body;

    const ticket = await prisma.ticket.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId,
      },
    });

    if (!ticket) {
      throw new AppError('Ticket not found', 404);
    }

    const updated = await prisma.ticket.update({
      where: { id: req.params.id },
      data: {
        ...(status && { status }),
        ...(priority && { priority }),
        ...(assignedTo !== undefined && { assignedTo }),
        ...(status === 'closed' && { closedAt: new Date() }),
      },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// Add message to ticket
router.post('/:id/messages', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { content, isInternal } = req.body;

    const ticket = await prisma.ticket.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId,
      },
    });

    if (!ticket) {
      throw new AppError('Ticket not found', 404);
    }

    const message = await prisma.ticketMessage.create({
      data: {
        ticketId: req.params.id,
        userId: req.userId,
        senderType: 'agent',
        content,
        isInternal: isInternal || false,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    // Send non-internal agent replies back to the source platform (Slack, etc.)
    if (!isInternal) {
      sendResponseToSource(req.params.id, content).catch((err) => {
        console.error('Failed to relay message to source:', err);
      });
    }

    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
});

// Delete ticket
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ticket = await prisma.ticket.findFirst({
      where: {
        id: req.params.id,
        organizationId: req.organizationId,
      },
    });

    if (!ticket) {
      throw new AppError('Ticket not found', 404);
    }

    // Delete all messages first (cascade delete)
    await prisma.ticketMessage.deleteMany({
      where: { ticketId: req.params.id },
    });

    // Delete the ticket
    await prisma.ticket.delete({
      where: { id: req.params.id },
    });

    res.json({ success: true, message: 'Ticket deleted successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
