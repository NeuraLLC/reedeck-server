import { Router } from 'express';
import { Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { attachOrganization } from '../middleware/organization';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import logger from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import { sendResponseToSource } from '../services/channelRelay';
import { supabaseAdmin } from '../config/supabase';

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
          orderBy: { createdAt: 'desc' },
        },
        tags: true,
      },
      orderBy: { updatedAt: 'desc' },
      skip: (Number(page) - 1) * Number(limit),
      take: Number(limit),
    });

    // Add unread flag to each ticket
    const ticketsWithUnread = tickets.map((ticket: any) => {
      // Ticket is unread if:
      // 1. Never been viewed (lastViewedAt is null), OR
      // 2. Has customer or system messages created after lastViewedAt
      // (Agent messages don't mark the ticket as unread)
      const lastViewed = ticket.lastViewedAt as Date | null;
      const isUnread = !lastViewed ||
        ticket.messages.some((msg: any) =>
          msg.createdAt > lastViewed! &&
          (msg.senderType === 'customer' || msg.senderType === 'system')
        );

      return {
        ...ticket,
        isUnread,
      };
    });

    // Sort by unread status first, then by updatedAt
    ticketsWithUnread.sort((a: any, b: any) => {
      if (a.isUnread && !b.isUnread) return -1;
      if (!a.isUnread && b.isUnread) return 1;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    const total = await prisma.ticket.count({ where });

    res.json({
      tickets: ticketsWithUnread,
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

// Mark ticket as read
router.post('/:id/mark-read', async (req: AuthRequest, res: Response, next: NextFunction) => {
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

    const updated = await prisma.ticket.update({
      where: { id: req.params.id },
      data: { lastViewedAt: new Date() },
    });

    res.json({ success: true, lastViewedAt: updated.lastViewedAt });
  } catch (error) {
    next(error);
  }
});

// Create internal ticket
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { subject, priority, message, sourceId, type } = req.body;

    const ticket = await prisma.ticket.create({
      data: {
        organizationId: req.organizationId!,
        ...(sourceId && { sourceId }),
        customerName: 'Internal',
        customerEmail: `agent@${req.organizationId}.internal`,
        subject,
        priority: priority || 'medium',
        status: 'open',
        metadata: { type: type || 'support' },
        messages: {
          create: {
            senderType: 'agent',
            content: message,
            userId: req.userId,
          },
        },
      },
      include: {
        messages: true,
      },
    });

    // Broadcast realtime event
    supabaseAdmin.channel(`org:${req.organizationId}`).send({
      type: 'broadcast',
      event: 'ticket_created',
      payload: { ticketId: ticket.id },
    });

    res.status(201).json(ticket);
  } catch (error) {
    next(error);
  }
});

// Broadcast message to all known channels/groups for selected sources
router.post('/broadcast', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { sourceIds, message } = req.body;

    if (!sourceIds || sourceIds.length === 0 || !message) {
      return res.status(400).json({ error: 'sourceIds and message are required' });
    }

    const results: { sourceId: string; sourceType: string; channels: number; errors: number }[] = [];

    for (const sourceId of sourceIds) {
      const sourceConnection = await prisma.sourceConnection.findFirst({
        where: {
          id: sourceId,
          organizationId: req.organizationId!,
          isActive: true,
        },
      });

      if (!sourceConnection) continue;

      const sourceType = sourceConnection.sourceType.toLowerCase();

      // Find all unique channels/chats from existing tickets for this source
      let channelField: string;
      if (sourceType === 'slack') channelField = 'slackChannelId';
      else if (sourceType === 'discord') channelField = 'discordChannelId';
      else if (sourceType === 'telegram') channelField = 'telegramChatId';
      else continue; // Skip unsupported platforms for broadcast

      const tickets = await prisma.ticket.findMany({
        where: {
          organizationId: req.organizationId!,
          sourceId,
          metadata: { path: [channelField], not: 'null' },
        },
        select: { metadata: true },
        distinct: ['metadata'],
      });

      // Extract unique channel IDs
      const channelIds = new Set<string>();
      for (const t of tickets) {
        const meta = t.metadata as any;
        if (meta?.[channelField]) channelIds.add(meta[channelField]);
      }

      let sent = 0;
      let errors = 0;

      for (const channelId of channelIds) {
        try {
          if (sourceType === 'slack') {
            const { SlackIntegration } = require('../services/integrations');
            await SlackIntegration.sendMessage(
              sourceConnection.credentials as string,
              channelId,
              message
            );
          } else if (sourceType === 'discord') {
            const { DiscordIntegration } = require('../services/integrations');
            await DiscordIntegration.sendMessage(
              sourceConnection.credentials as string,
              channelId,
              message
            );
          } else if (sourceType === 'telegram') {
            const { TelegramIntegration } = require('../services/integrations');
            await TelegramIntegration.sendMessage(
              sourceConnection.credentials as string,
              channelId,
              message
            );
          }
          sent++;
        } catch (err) {
          logger.error(`[BROADCAST] Failed to send to ${sourceType} channel ${channelId}:`, err);
          errors++;
        }
      }

      results.push({
        sourceId,
        sourceType: sourceConnection.sourceType,
        channels: sent,
        errors,
      });
    }

    const totalSent = results.reduce((sum, r) => sum + r.channels, 0);
    res.json({ success: true, totalChannels: totalSent, results });
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

    // Broadcast realtime event so other dashboard viewers see the new message
    if (ticket.organizationId) {
      supabaseAdmin.channel(`org:${ticket.organizationId}`).send({
        type: 'broadcast',
        event: 'ticket_updated',
        payload: { ticketId: req.params.id },
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
