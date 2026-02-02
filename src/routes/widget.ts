import { Router, Request, Response } from 'express';
import prisma from '../config/database';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

/**
 * GET /widget/config/:organizationId
 * Public endpoint to get widget configuration
 */
router.get('/config/:organizationId', async (req: Request, res: Response) => {
  try {
    const { organizationId } = req.params;

    let config = await prisma.widgetConfig.findUnique({
      where: { organizationId },
    });

    // If no config exists, create default one
    if (!config) {
      config = await prisma.widgetConfig.create({
        data: {
          organizationId,
        },
      });
    }

    // Only return public-safe fields
    const publicConfig = {
      primaryColor: config.primaryColor,
      position: config.position,
      greeting: config.greeting,
      offlineMessage: config.offlineMessage,
      showLogo: config.showLogo,
      enabled: config.enabled,
      requireEmail: config.requireEmail,
    };

    res.json(publicConfig);
  } catch (error) {
    console.error('Error fetching widget config:', error);
    res.status(500).json({ error: 'Failed to fetch widget configuration' });
  }
});

/**
 * PUT /widget/config
 * Protected endpoint to update widget configuration
 */
router.put('/config', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { organizationId } = req.body;
    const {
      primaryColor,
      position,
      greeting,
      offlineMessage,
      showLogo,
      enabled,
      requireEmail,
    } = req.body;

    const config = await prisma.widgetConfig.upsert({
      where: { organizationId },
      update: {
        primaryColor,
        position,
        greeting,
        offlineMessage,
        showLogo,
        enabled,
        requireEmail,
      },
      create: {
        organizationId,
        primaryColor,
        position,
        greeting,
        offlineMessage,
        showLogo,
        enabled,
        requireEmail,
      },
    });

    res.json(config);
  } catch (error) {
    console.error('Error updating widget config:', error);
    res.status(500).json({ error: 'Failed to update widget configuration' });
  }
});

/**
 * POST /widget/session
 * Create or retrieve a widget session
 */
router.post('/session', async (req: Request, res: Response) => {
  try {
    const { visitorId, organizationId, metadata = {} } = req.body;

    if (!visitorId || !organizationId) {
      return res.status(400).json({ error: 'visitorId and organizationId are required' });
    }

    // Check for existing active session
    let session = await prisma.widgetSession.findFirst({
      where: {
        visitorId,
        metadata: {
          path: ['organizationId'],
          equals: organizationId,
        },
      },
      orderBy: {
        lastSeen: 'desc',
      },
    });

    if (session) {
      // Update last seen
      session = await prisma.widgetSession.update({
        where: { id: session.id },
        data: {
          lastSeen: new Date(),
        },
      });
    } else {
      // Create new session
      session = await prisma.widgetSession.create({
        data: {
          visitorId,
          metadata: {
            ...metadata,
            organizationId,
          },
          lastSeen: new Date(),
        },
      });
    }

    res.json(session);
  } catch (error) {
    console.error('Error creating widget session:', error);
    res.status(500).json({ error: 'Failed to create widget session' });
  }
});

/**
 * POST /widget/message
 * Send a message from widget (customer or agent)
 */
router.post('/message', async (req: Request, res: Response) => {
  try {
    const { sessionId, senderType, content, customerName, customerEmail } = req.body;

    if (!sessionId || !senderType || !content) {
      return res.status(400).json({ error: 'sessionId, senderType, and content are required' });
    }

    // Get session
    const session = await prisma.widgetSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const metadata = session.metadata as any;
    const organizationId = metadata?.organizationId;

    // Create message
    const message = await prisma.widgetMessage.create({
      data: {
        sessionId,
        senderType,
        content,
      },
    });

    // If this is first customer message and no ticket exists, create ticket
    if (senderType === 'customer' && !session.ticketId) {
      const ticket = await prisma.ticket.create({
        data: {
          organizationId,
          customerName: customerName || 'Website Visitor',
          customerEmail: customerEmail || `visitor-${session.visitorId}@widget.reedeck.com`,
          subject: content.substring(0, 100) || 'New widget conversation',
          status: 'open',
          priority: 'medium',
          metadata: {
            source: 'widget',
            sessionId: session.id,
            visitorId: session.visitorId,
          },
        },
      });

      // Link session to ticket
      await prisma.widgetSession.update({
        where: { id: sessionId },
        data: {
          ticketId: ticket.id,
          customerId: customerEmail,
        },
      });

      // Create initial ticket message
      await prisma.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          senderType: 'customer',
          content,
        },
      });
    } else if (session.ticketId) {
      // Add message to existing ticket
      await prisma.ticketMessage.create({
        data: {
          ticketId: session.ticketId,
          senderType,
          content,
        },
      });
    }

    res.json(message);
  } catch (error) {
    console.error('Error sending widget message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

/**
 * GET /widget/messages/:sessionId
 * Get messages for a session
 */
router.get('/messages/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { since } = req.query;

    const where: any = { sessionId };
    if (since) {
      where.createdAt = {
        gt: new Date(since as string),
      };
    }

    const messages = await prisma.widgetMessage.findMany({
      where,
      orderBy: {
        createdAt: 'asc',
      },
    });

    res.json(messages);
  } catch (error) {
    console.error('Error fetching widget messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

/**
 * GET /widget/session/:sessionId
 * Get session details
 */
router.get('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    const session = await prisma.widgetSession.findUnique({
      where: { id: sessionId },
      include: {
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(session);
  } catch (error) {
    console.error('Error fetching widget session:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

export default router;
