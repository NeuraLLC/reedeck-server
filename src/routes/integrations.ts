import { Router, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { attachOrganization, requireAdmin } from '../middleware/organization';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import crypto from 'crypto';
import {
  SlackIntegration,
  GmailIntegration,
  DiscordIntegration,
  TelegramIntegration,
  ClickUpIntegration,
  WhatsAppIntegration,
  TeamsIntegration,
  XIntegration,
  InstagramIntegration,
  AsanaIntegration,
} from '../services/integrations';

const router = Router();

// Store OAuth states temporarily (in production, use Redis)
const oauthStates = new Map<string, { organizationId: string; platform: string; expiresAt: number }>();

// Clean up expired states every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of oauthStates.entries()) {
    if (data.expiresAt < now) {
      oauthStates.delete(state);
    }
  }
}, 5 * 60 * 1000);

// OAuth callback - receive code from platform (NO AUTH - this is a redirect from the OAuth provider)
router.get(
  '/:platform/oauth/callback',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { platform } = req.params;
      const { code, state } = req.query;

      if (!code || !state) {
        return res.redirect(`${process.env.FRONTEND_URL}/sources?error=missing_params`);
      }

      // Validate state
      const stateData = oauthStates.get(state as string);
      if (!stateData || stateData.platform !== platform.toLowerCase()) {
        return res.redirect(`${process.env.FRONTEND_URL}/sources?error=invalid_state`);
      }

      // Remove used state
      oauthStates.delete(state as string);

      // Check if already connected
      const existing = await prisma.sourceConnection.findFirst({
        where: {
          organizationId: stateData.organizationId,
          sourceType: platform,
        },
      });

      if (existing) {
        return res.redirect(`${process.env.FRONTEND_URL}/sources?error=already_connected`);
      }

      let result: any;

      // Exchange code for token based on platform
      switch (platform.toLowerCase()) {
        case 'slack':
          result = await SlackIntegration.exchangeCodeForToken(code as string);
          break;
        case 'gmail':
          result = await GmailIntegration.exchangeCodeForToken(code as string);
          break;
        case 'discord':
          result = await DiscordIntegration.exchangeCodeForToken(code as string);
          break;
        case 'teams':
          result = await TeamsIntegration.exchangeCodeForToken(code as string);
          break;
        case 'x':
          result = await XIntegration.exchangeCodeForToken(code as string);
          break;
        case 'instagram':
          result = await InstagramIntegration.exchangeCodeForToken(code as string);
          break;
        case 'asana':
          result = await AsanaIntegration.exchangeCodeForToken(code as string);
          break;
        case 'clickup':
          result = await ClickUpIntegration.exchangeCodeForToken(code as string);
          break;
        default:
          return res.redirect(`${process.env.FRONTEND_URL}/sources?error=unsupported_platform`);
      }

      // Store connection in database
      const connection = await prisma.sourceConnection.create({
        data: {
          organizationId: stateData.organizationId,
          sourceType: platform,
          credentials: result.credentials,
          metadata: result.metadata,
          sourceId: result.sourceId,
          isActive: true,
        },
      });

      // Subscribe to webhooks for platforms that support it
      try {
        const webhookBaseUrl = process.env.WEBHOOK_BASE_URL || process.env.FRONTEND_URL?.replace('3000', '4001') || 'http://localhost:4001';

        switch (platform.toLowerCase()) {
          case 'instagram':
            if (result.metadata?.userId) {
              await InstagramIntegration.subscribeToWebhooks(
                result.credentials,
                result.metadata.userId,
                `${webhookBaseUrl}/api/integrations/webhooks/instagram`
              );
            }
            break;
          case 'telegram':
            await TelegramIntegration.setWebhook(
              result.credentials,
              `${webhookBaseUrl}/api/integrations/webhooks/telegram`
            );
            break;
        }
      } catch (webhookError) {
        console.error(`Failed to subscribe to webhooks for ${platform}:`, webhookError);
      }

      // Redirect to frontend with success
      res.redirect(`${process.env.FRONTEND_URL}/sources?connected=${platform}`);
    } catch (error) {
      console.error('OAuth callback error:', error);
      res.redirect(`${process.env.FRONTEND_URL}/sources?error=oauth_failed`);
    }
  }
);

// All routes below require authentication
router.use(authenticate);
router.use(attachOrganization);

// Available platforms
const AVAILABLE_PLATFORMS = [
  {
    name: 'Telegram',
    description: 'Receive messages from Telegram',
    icon: 'telegram',
  },
  {
    name: 'X',
    description: 'Connect your X (Twitter) account',
    icon: 'x',
  },
  {
    name: 'Slack',
    description: 'Integrate with your Slack workspace',
    icon: 'slack',
  },
  {
    name: 'Teams',
    description: 'Connect Microsoft Teams for workplace collaboration',
    icon: 'teams',
  },
  {
    name: 'Gmail',
    description: 'Receive emails from Gmail',
    icon: 'gmail',
  },
  {
    name: 'Discord',
    description: 'Connect Discord for community support',
    icon: 'discord',
  },
  {
    name: 'WhatsApp',
    description: 'Integrate WhatsApp Business for customer messaging',
    icon: 'whatsapp',
  },
  {
    name: 'Instagram',
    description: 'Manage Instagram DMs and comments',
    icon: 'instagram',
  },
  {
    name: 'ClickUp',
    description: 'Sync tasks with ClickUp for autonomous PM',
    icon: 'clickup',
  },
  {
    name: 'Asana',
    description: 'Create and manage tasks in Asana',
    icon: 'asana',
  },
];

// Get all available integrations
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Get connected integrations for this organization
    const connectedIntegrations = await prisma.sourceConnection.findMany({
      where: {
        organizationId: req.organizationId,
      },
    });

    res.json(connectedIntegrations);
  } catch (error) {
    next(error);
  }
});

// OAuth initialization - redirect to platform authorization
router.get(
  '/:platform/oauth/init',
  requireAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { platform } = req.params;
      const state = crypto.randomBytes(16).toString('hex');

      // Store state with organization ID and expiry (15 minutes)
      oauthStates.set(state, {
        organizationId: req.organizationId!,
        platform: platform.toLowerCase(),
        expiresAt: Date.now() + 15 * 60 * 1000,
      });

      let authUrl: string;

      switch (platform.toLowerCase()) {
        case 'slack':
          authUrl = SlackIntegration.generateAuthUrl(state);
          break;
        case 'gmail':
          authUrl = GmailIntegration.generateAuthUrl(state);
          break;
        case 'discord':
          authUrl = DiscordIntegration.generateAuthUrl(state);
          break;
        case 'teams':
          authUrl = TeamsIntegration.generateAuthUrl(state);
          break;
        case 'x':
          authUrl = XIntegration.generateAuthUrl(state);
          break;
        case 'instagram':
          authUrl = InstagramIntegration.generateAuthUrl(state);
          break;
        case 'asana':
          authUrl = AsanaIntegration.generateAuthUrl(state);
          break;
        case 'clickup':
          authUrl = ClickUpIntegration.generateAuthUrl(state);
          break;
        default:
          throw new AppError('OAuth not supported for this platform', 400);
      }

      res.json({ url: authUrl });
    } catch (error) {
      next(error);
    }
  }
);

// OAuth callback is defined above (before auth middleware)

// API Key / Token connection (for Telegram, WhatsApp, ClickUp)
router.post(
  '/:platform/connect',
  requireAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { platform } = req.params;
      const { apiKey, apiSecret } = req.body;

      // Check if platform is valid
      const validPlatform = AVAILABLE_PLATFORMS.find(
        (p) => p.name.toLowerCase() === platform.toLowerCase()
      );

      if (!validPlatform) {
        throw new AppError('Invalid platform', 400);
      }

      // Check if already connected
      const existing = await prisma.sourceConnection.findFirst({
        where: {
          organizationId: req.organizationId,
          sourceType: validPlatform.name,
        },
      });

      if (existing) {
        throw new AppError('Platform already connected', 400);
      }

      let result: any;

      // Validate credentials based on platform
      switch (platform.toLowerCase()) {
        case 'telegram':
          if (!apiKey) {
            throw new AppError('Bot token is required', 400);
          }
          result = await TelegramIntegration.validateToken(apiKey);
          break;

        case 'whatsapp':
          if (!apiKey || !apiSecret) {
            throw new AppError('Account SID and Auth Token are required', 400);
          }
          const { phoneNumber } = req.body;
          if (!phoneNumber) {
            throw new AppError('Phone number is required', 400);
          }
          result = await WhatsAppIntegration.validateCredentials(
            apiKey,
            apiSecret,
            phoneNumber
          );
          break;

        case 'clickup':
          if (!apiKey) {
            throw new AppError('API key is required', 400);
          }
          result = await ClickUpIntegration.validateApiKey(apiKey);
          break;

        default:
          throw new AppError('API key connection not supported for this platform. Use OAuth instead.', 400);
      }

      // Store connection in database
      const connection = await prisma.sourceConnection.create({
        data: {
          organizationId: req.organizationId!,
          sourceType: validPlatform.name,
          credentials: result.credentials,
          metadata: result.metadata,
          sourceId: result.sourceId,
          isActive: true,
        },
      });

      res.status(201).json({
        success: true,
        message: `${validPlatform.name} connected successfully`,
        connection: {
          id: connection.id,
          sourceType: connection.sourceType,
          isActive: connection.isActive,
          createdAt: connection.createdAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// Disconnect integration
router.post(
  '/:platform/disconnect',
  requireAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { platform } = req.params;

      const connection = await prisma.sourceConnection.findFirst({
        where: {
          organizationId: req.organizationId,
          sourceType: {
            equals: platform,
            mode: 'insensitive',
          },
        },
      });

      if (!connection) {
        throw new AppError('Platform not connected', 404);
      }

      // Delete the connection
      await prisma.sourceConnection.delete({
        where: { id: connection.id },
      });

      res.json({
        success: true,
        message: `${platform} disconnected successfully`,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get integration status
router.get('/:platform/status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { platform } = req.params;

    const connection = await prisma.sourceConnection.findFirst({
      where: {
        organizationId: req.organizationId,
        sourceType: {
          equals: platform,
          mode: 'insensitive',
        },
      },
    });

    if (!connection) {
      return res.json({
        connected: false,
        lastSync: null,
      });
    }

    res.json({
      connected: connection.isActive,
      lastSync: connection.lastSyncAt,
      connectedAt: connection.createdAt,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
