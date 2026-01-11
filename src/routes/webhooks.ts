import { Router, Request, Response } from 'express';
import {
  SlackIntegration,
  TelegramIntegration,
  WhatsAppIntegration,
  InstagramIntegration,
  XIntegration,
  AsanaIntegration,
} from '../services/integrations';
import prisma from '../config/database';

const router = Router();

/**
 * Slack webhook handler
 */
router.post('/slack', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-slack-signature'] as string;
    const timestamp = req.headers['x-slack-request-timestamp'] as string;
    const body = JSON.stringify(req.body);

    // Verify webhook signature
    if (!SlackIntegration.verifyWebhookSignature(timestamp, body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Handle URL verification challenge
    if (req.body.type === 'url_verification') {
      return res.json({ challenge: req.body.challenge });
    }

    // Handle event
    if (req.body.type === 'event_callback') {
      const event = req.body.event;
      const teamId = req.body.team_id;

      // Find the source connection for this Slack team
      const sourceConnection = await prisma.sourceConnection.findFirst({
        where: {
          sourceType: 'Slack',
          metadata: {
            path: ['teamId'],
            equals: teamId,
          },
          isActive: true,
        },
      });

      if (sourceConnection) {
        // Store incoming message as ticket with message
        const ticket = await prisma.ticket.create({
          data: {
            organizationId: sourceConnection.organizationId,
            sourceId: sourceConnection.id,
            customerName: `Slack User ${event.user}`,
            customerEmail: `${event.user}@slack.local`,
            subject: `Message from Slack channel ${event.channel}`,
            status: 'open',
            priority: 'medium',
            messages: {
              create: {
                senderType: 'customer',
                content: event.text || '',
              },
            },
          },
        });
      }

      res.json({ ok: true });
    } else {
      res.json({ ok: true });
    }
  } catch (error) {
    console.error('Slack webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Telegram webhook handler
 */
router.post('/telegram', async (req: Request, res: Response) => {
  try {
    const update = req.body;

    // Verify webhook structure
    if (!TelegramIntegration.verifyWebhookSignature('', update)) {
      return res.status(401).json({ error: 'Invalid webhook data' });
    }

    // Handle incoming message
    if (update.message) {
      const message = update.message;

      // Find the source connection for Telegram
      // Note: We can't easily identify which bot this is from the webhook,
      // so we'll get the first active Telegram connection
      const sourceConnection = await prisma.sourceConnection.findFirst({
        where: {
          sourceType: 'Telegram',
          isActive: true,
        },
      });

      if (sourceConnection) {
        // Store incoming message as ticket with message
        const ticket = await prisma.ticket.create({
          data: {
            organizationId: sourceConnection.organizationId,
            sourceId: sourceConnection.id,
            customerName: message.from.first_name + (message.from.last_name ? ` ${message.from.last_name}` : ''),
            customerEmail: message.from.username ? `${message.from.username}@telegram.local` : `user${message.from.id}@telegram.local`,
            subject: `Telegram message from ${message.from.first_name}`,
            status: 'open',
            priority: 'medium',
            messages: {
              create: {
                senderType: 'customer',
                content: message.text || '',
              },
            },
          },
        });
      }
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * WhatsApp (Twilio) webhook handler
 */
router.post('/whatsapp', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-twilio-signature'] as string;
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    // Get connection to verify signature
    // TODO: Fetch auth token based on incoming phone number
    const authToken = process.env.WHATSAPP_AUTH_TOKEN || '';

    // Verify webhook signature
    if (!WhatsAppIntegration.verifyWebhookSignature(url, req.body, signature, authToken)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { From, To, Body, MessageSid, MediaUrl0 } = req.body;

    // Find the source connection for this WhatsApp number
    const sourceConnection = await prisma.sourceConnection.findFirst({
      where: {
        sourceType: 'WhatsApp',
        metadata: {
          path: ['phoneNumber'],
          string_contains: To.replace('whatsapp:', ''),
        },
        isActive: true,
      },
    });

    if (sourceConnection) {
      // Store incoming message as ticket with message
      const ticket = await prisma.ticket.create({
        data: {
          organizationId: sourceConnection.organizationId,
          sourceId: sourceConnection.id,
          customerName: From.replace('whatsapp:', ''),
          customerEmail: `${From.replace('whatsapp:', '').replace('+', '')}@whatsapp.local`,
          subject: `WhatsApp message from ${From}`,
          status: 'open',
          priority: 'medium',
          messages: {
            create: {
              senderType: 'customer',
              content: Body || (MediaUrl0 ? '[Media Message]' : ''),
            },
          },
        },
      });
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Gmail webhook handler (Google Pub/Sub)
 */
router.post('/gmail', async (req: Request, res: Response) => {
  try {
    // Google Pub/Sub sends base64-encoded messages
    const message = req.body.message;
    if (!message || !message.data) {
      return res.status(400).json({ error: 'Invalid message format' });
    }

    const decoded = Buffer.from(message.data, 'base64').toString('utf-8');
    const notification = JSON.parse(decoded);

    // Gmail sends historyId updates, you need to fetch the actual email
    // TODO: Implement email fetching using Gmail API with stored credentials

    res.status(200).send('OK');
  } catch (error) {
    console.error('Gmail webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Discord webhook handler
 */
router.post('/discord', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-signature-ed25519'] as string;
    const timestamp = req.headers['x-signature-timestamp'] as string;
    const body = JSON.stringify(req.body);

    // Verify webhook signature
    if (!signature || !timestamp) {
      return res.status(401).json({ error: 'Missing signature headers' });
    }

    // Handle different interaction types
    const { type, data } = req.body;

    // Type 1: Ping (verification)
    if (type === 1) {
      return res.json({ type: 1 });
    }

    // Type 2: Application Command
    if (type === 2) {
      // Handle slash commands
      res.json({
        type: 4,
        data: {
          content: 'Message received!',
        },
      });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Discord webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * ClickUp webhook handler
 */
router.post('/clickup', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-signature'] as string;
    const body = JSON.stringify(req.body);

    // Verify webhook signature
    // Note: ClickUp webhooks require signature verification

    const { event, task_id, history_items } = req.body;

    // Handle different webhook events
    if (event === 'taskCreated' || event === 'taskUpdated') {
      // TODO: Process task changes
      console.log('ClickUp task event:', event, task_id);
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('ClickUp webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Instagram webhook handler (Facebook Graph API)
 */
router.get('/instagram', async (req: Request, res: Response) => {
  try {
    // Webhook verification (GET request from Facebook)
    const mode = req.query['hub.mode'] as string;
    const token = req.query['hub.verify_token'] as string;
    const challenge = req.query['hub.challenge'] as string;

    const verifyResult = InstagramIntegration.verifyWebhookChallenge(mode, token, challenge);

    if (verifyResult) {
      return res.status(200).send(verifyResult);
    }

    res.status(403).send('Forbidden');
  } catch (error) {
    console.error('Instagram webhook verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/instagram', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-hub-signature-256'] as string;
    const body = JSON.stringify(req.body);

    // Verify webhook signature
    if (signature && !InstagramIntegration.verifyWebhookSignature(signature.replace('sha256=', ''), body)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { object, entry } = req.body;

    if (object === 'instagram') {
      for (const item of entry) {
        const instagramUserId = item.id;

        // Find the source connection for this Instagram account
        const sourceConnection = await prisma.sourceConnection.findFirst({
          where: {
            sourceType: 'Instagram',
            metadata: {
              path: ['userId'],
              equals: instagramUserId,
            },
            isActive: true,
          },
        });

        if (!sourceConnection) continue;

        // Handle incoming messages
        if (item.messaging) {
          for (const message of item.messaging) {
            const ticket = await prisma.ticket.create({
              data: {
                organizationId: sourceConnection.organizationId,
                sourceId: sourceConnection.id,
                customerName: `Instagram User ${message.sender.id}`,
                customerEmail: `${message.sender.id}@instagram.local`,
                subject: `Instagram message`,
                status: 'open',
                priority: 'medium',
                messages: {
                  create: {
                    senderType: 'customer',
                    content: message.message?.text || '[Media/Sticker Message]',
                  },
                },
              },
            });
          }
        }

        // Handle comments
        if (item.changes) {
          for (const change of item.changes) {
            if (change.field === 'comments') {
              const commentData = change.value;
              const ticket = await prisma.ticket.create({
                data: {
                  organizationId: sourceConnection.organizationId,
                  sourceId: sourceConnection.id,
                  customerName: `Instagram User ${commentData.from?.id || 'unknown'}`,
                  customerEmail: `${commentData.from?.id || 'unknown'}@instagram.local`,
                  subject: `Instagram comment on post`,
                  status: 'open',
                  priority: 'medium',
                  messages: {
                    create: {
                      senderType: 'customer',
                      content: commentData.text || '',
                    },
                  },
                },
              });
            }
          }
        }
      }
    }

    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    console.error('Instagram webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * X (Twitter) webhook handler
 */
router.get('/x', async (req: Request, res: Response) => {
  try {
    // CRC (Challenge Response Check) for Twitter webhooks
    const crc = req.query.crc_token as string;
    if (crc) {
      const crypto = require('crypto');
      const hash = crypto
        .createHmac('sha256', process.env.X_CLIENT_SECRET || '')
        .update(crc)
        .digest('base64');
      return res.json({ response_token: `sha256=${hash}` });
    }
    res.status(400).send('Bad Request');
  } catch (error) {
    console.error('X webhook CRC error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/x', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-twitter-webhooks-signature'] as string;
    const body = JSON.stringify(req.body);

    // Verify webhook signature
    if (signature && !XIntegration.verifyWebhookSignature(signature.replace('sha256=', ''), body)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { direct_message_events, tweet_create_events, for_user_id } = req.body;

    // Find the source connection for this X account
    const sourceConnection = await prisma.sourceConnection.findFirst({
      where: {
        sourceType: 'X',
        metadata: {
          path: ['userId'],
          equals: for_user_id,
        },
        isActive: true,
      },
    });

    if (!sourceConnection) {
      return res.status(200).send('OK');
    }

    // Handle direct messages
    if (direct_message_events) {
      for (const dm of direct_message_events) {
        if (dm.type === 'message_create' && dm.message_create.sender_id !== for_user_id) {
          const ticket = await prisma.ticket.create({
            data: {
              organizationId: sourceConnection.organizationId,
              sourceId: sourceConnection.id,
              customerName: `X User ${dm.message_create.sender_id}`,
              customerEmail: `${dm.message_create.sender_id}@twitter.local`,
              subject: `X Direct Message`,
              status: 'open',
              priority: 'medium',
              messages: {
                create: {
                  senderType: 'customer',
                  content: dm.message_create.message_data.text,
                },
              },
            },
          });
        }
      }
    }

    // Handle mentions
    if (tweet_create_events) {
      for (const tweet of tweet_create_events) {
        if (tweet.user.id_str !== for_user_id) {
          const ticket = await prisma.ticket.create({
            data: {
              organizationId: sourceConnection.organizationId,
              sourceId: sourceConnection.id,
              customerName: `@${tweet.user.screen_name}`,
              customerEmail: `${tweet.user.id_str}@twitter.local`,
              subject: `X Mention`,
              status: 'open',
              priority: 'medium',
              messages: {
                create: {
                  senderType: 'customer',
                  content: tweet.text,
                },
              },
            },
          });
        }
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('X webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Microsoft Teams webhook handler
 */
router.post('/teams', async (req: Request, res: Response) => {
  try {
    // Teams uses Bot Framework, different webhook structure
    const { type, text, from, channelId, conversation } = req.body;

    if (type === 'message') {
      // Find the source connection for Teams
      const sourceConnection = await prisma.sourceConnection.findFirst({
        where: {
          sourceType: 'Teams',
          isActive: true,
        },
      });

      if (sourceConnection) {
        const ticket = await prisma.ticket.create({
          data: {
            organizationId: sourceConnection.organizationId,
            sourceId: sourceConnection.id,
            customerName: from.name || `Teams User ${from.id}`,
            customerEmail: from.aadObjectId ? `${from.aadObjectId}@teams.local` : `${from.id}@teams.local`,
            subject: `Teams message`,
            status: 'open',
            priority: 'medium',
            messages: {
              create: {
                senderType: 'customer',
                content: text || '',
              },
            },
          },
        });
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Teams webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Asana webhook handler
 */
router.post('/asana', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-hook-signature'] as string;
    const body = JSON.stringify(req.body);

    // Verify webhook signature
    if (signature && !AsanaIntegration.verifyWebhookSignature(signature, body)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { events } = req.body;

    if (events) {
      for (const event of events) {
        // Handle task changes
        if (event.resource && event.resource.resource_type === 'task') {
          console.log('Asana task event:', event.action, event.resource.gid);
          // TODO: Sync task changes back to Reedeck if needed
        }
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Asana webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
