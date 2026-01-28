import { Router, Request, Response } from 'express';
import {
  SlackIntegration,
  GmailIntegration,
  TelegramIntegration,
  WhatsAppIntegration,
  InstagramIntegration,
  XIntegration,
  AsanaIntegration,
} from '../services/integrations';
import prisma from '../config/database';
import logger from '../config/logger';

const router = Router();

/**
 * Health check endpoint for webhooks
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    webhooks: {
      slack: `${req.protocol}://${req.get('host')}/api/integrations/webhooks/slack`,
      gmail: `${req.protocol}://${req.get('host')}/api/integrations/webhooks/gmail`,
    },
  });
});

/**
 * Slack webhook handler
 * Handles incoming messages, groups conversations into tickets, enriches user info,
 * and triggers AI processing.
 */
router.post('/slack', async (req: Request, res: Response) => {
  console.log('[SLACK WEBHOOK] Received:', JSON.stringify({
    type: req.body.type,
    eventType: req.body.event?.type,
    teamId: req.body.team_id,
  }));

  logger.info('Slack webhook received', {
    type: req.body.type,
    eventType: req.body.event?.type,
    teamId: req.body.team_id,
  });
  try {
    const signature = req.headers['x-slack-signature'] as string;
    const timestamp = req.headers['x-slack-request-timestamp'] as string;
    const body = JSON.stringify(req.body);

    console.log('[SLACK] Verifying signature...');
    // Verify webhook signature
    if (!SlackIntegration.verifyWebhookSignature(timestamp, body, signature)) {
      console.log('[SLACK] ❌ Signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    console.log('[SLACK] ✅ Signature verified');

    // Handle URL verification challenge
    if (req.body.type === 'url_verification') {
      console.log('[SLACK] URL verification challenge');
      return res.json({ challenge: req.body.challenge });
    }

    // Handle event callbacks
    if (req.body.type === 'event_callback') {
      const event = req.body.event;
      const teamId = req.body.team_id;

      console.log('[SLACK] Event details:', JSON.stringify({
        type: event.type,
        hasText: !!event.text,
        hasBotId: !!event.bot_id,
        subtype: event.subtype,
        user: event.user,
        channel: event.channel,
      }));

      // Filter: only process actual user messages
      // Skip bot messages, message edits/deletes, and subtypes like channel_join
      if (
        event.type !== 'message' ||
        event.bot_id ||
        event.subtype ||
        !event.text
      ) {
        console.log('[SLACK] ⏭️  Message filtered out (bot, subtype, or no text)');
        return res.json({ ok: true });
      }

      console.log('[SLACK] ✅ Message passed filters, processing...');

      // Find the source connection for this Slack team
      console.log('[SLACK] Looking for source connection with teamId:', teamId);
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

      if (!sourceConnection) {
        console.log('[SLACK] ❌ No source connection found for teamId:', teamId);
        return res.json({ ok: true });
      }

      console.log('[SLACK] ✅ Source connection found:', sourceConnection.id);

      // Enrich user info from Slack API (real name, email)
      let customerName = `Slack User ${event.user}`;
      let customerEmail = `${event.user}@slack.local`;
      console.log('[SLACK] Fetching user info for:', event.user);
      try {
        const userInfo = await SlackIntegration.getUserInfo(
          sourceConnection.credentials as string,
          event.user
        );
        customerName = userInfo.realName;
        customerEmail = userInfo.email || `${event.user}@slack.local`;
        console.log('[SLACK] ✅ User info fetched:', { customerName, customerEmail });
      } catch (err) {
        console.error('[SLACK] ❌ Failed to fetch user info:', err);
      }

      // Get channel name for subject
      let channelName = event.channel;
      try {
        const channelInfo = await SlackIntegration.getChannelInfo(
          sourceConnection.credentials as string,
          event.channel
        );
        channelName = channelInfo.name;
      } catch (err) {
        // Keep channel ID as fallback
      }

      // Conversation threading: check for an existing open ticket from the same user in the same channel
      console.log('[SLACK] Checking for existing ticket...', { customerEmail, channel: event.channel });
      const existingTicket = await prisma.ticket.findFirst({
        where: {
          organizationId: sourceConnection.organizationId,
          sourceId: sourceConnection.id,
          customerEmail,
          status: { in: ['open', 'in_progress'] },
          metadata: {
            path: ['slackChannelId'],
            equals: event.channel,
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existingTicket) {
        console.log('[SLACK] ✅ Found existing ticket:', existingTicket.id);
        // Add message to existing ticket conversation
        await prisma.ticketMessage.create({
          data: {
            ticketId: existingTicket.id,
            senderType: 'customer',
            content: event.text,
          },
        });

        // Update ticket to re-open if it was in progress
        await prisma.ticket.update({
          where: { id: existingTicket.id },
          data: { updatedAt: new Date() },
        });

        // Re-trigger AI processing for the new message
        const organization = await prisma.organization.findUnique({
          where: { id: sourceConnection.organizationId },
          select: { settings: true },
        });
        const aiSettings = (organization?.settings as any)?.autonomousAI;
        if (aiSettings?.enabled && aiSettings?.autoResponseEnabled) {
          const { ticketProcessingQueue } = require('../config/queue');
          ticketProcessingQueue.add({
            ticketId: existingTicket.id,
            organizationId: sourceConnection.organizationId,
          });
        }
      } else {
        console.log('[SLACK] Creating new ticket...');
        // Create new ticket with Slack metadata for return communication
        const ticket = await prisma.ticket.create({
          data: {
            organizationId: sourceConnection.organizationId,
            sourceId: sourceConnection.id,
            customerName,
            customerEmail,
            subject: `Slack message from #${channelName}`,
            status: 'open',
            priority: 'medium',
            metadata: {
              source: 'slack',
              slackChannelId: event.channel,
              slackUserId: event.user,
              slackTeamId: teamId,
              slackMessageTs: event.ts,
            },
            messages: {
              create: {
                senderType: 'customer',
                content: event.text,
              },
            },
          },
        });
        console.log('[SLACK] ✅ Ticket created:', ticket.id);

        // Trigger autonomous AI processing if enabled
        const organization = await prisma.organization.findUnique({
          where: { id: sourceConnection.organizationId },
          select: { settings: true },
        });
        const aiSettings = (organization?.settings as any)?.autonomousAI;
        if (aiSettings?.enabled && aiSettings?.autoResponseEnabled) {
          const { ticketProcessingQueue } = require('../config/queue');
          ticketProcessingQueue.add({
            ticketId: ticket.id,
            organizationId: sourceConnection.organizationId,
          });
        }
      }

      res.json({ ok: true });
    } else {
      console.log('[SLACK] ⏭️  Not an event_callback, skipping');
      res.json({ ok: true });
    }
  } catch (error) {
    console.error('[SLACK] ❌ ERROR:', error);
    logger.error('Slack webhook error:', error);
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
 *
 * Google sends a Pub/Sub notification whenever the connected mailbox changes.
 * The notification contains the emailAddress and a historyId.  We use the
 * Gmail History API to fetch only the new INBOX messages since our last
 * recorded historyId, parse each email, and either append to an existing
 * open ticket (conversation threading by threadId) or create a new ticket.
 */
router.post('/gmail', async (req: Request, res: Response) => {
  logger.info('Gmail webhook received', {
    hasMessage: !!req.body.message,
    body: req.body,
  });

  try {
    // Google Pub/Sub sends base64-encoded messages
    const pubSubMessage = req.body.message;
    if (!pubSubMessage || !pubSubMessage.data) {
      return res.status(400).json({ error: 'Invalid message format' });
    }

    const decoded = Buffer.from(pubSubMessage.data, 'base64').toString('utf-8');
    const notification = JSON.parse(decoded);
    // notification = { emailAddress: "support@acme.com", historyId: "12345" }

    const { emailAddress, historyId } = notification;
    if (!emailAddress || !historyId) {
      return res.status(200).send('OK');
    }

    // Find the source connection for this Gmail account
    const sourceConnection = await prisma.sourceConnection.findFirst({
      where: {
        sourceType: 'Gmail',
        metadata: {
          path: ['email'],
          equals: emailAddress,
        },
        isActive: true,
      },
    });

    if (!sourceConnection) {
      logger.warn(`Gmail webhook: no source connection found for ${emailAddress}`);
      return res.status(200).send('OK');
    }

    // Use the stored historyId from metadata to fetch only new messages
    const storedMeta = sourceConnection.metadata as any;
    const lastHistoryId = storedMeta?.lastHistoryId;

    // If we don't have a previous historyId, store this one and skip
    // (first notification after watch setup — nothing to diff against)
    if (!lastHistoryId) {
      await prisma.sourceConnection.update({
        where: { id: sourceConnection.id },
        data: {
          metadata: { ...storedMeta, lastHistoryId: historyId },
        },
      });
      return res.status(200).send('OK');
    }

    // Refresh token if needed, then fetch new message IDs
    let credentials = sourceConnection.credentials as string;
    try {
      credentials = await GmailIntegration.refreshAccessToken(credentials);
      await prisma.sourceConnection.update({
        where: { id: sourceConnection.id },
        data: { credentials },
      });
    } catch (err) {
      logger.error('Gmail token refresh failed:', err);
    }

    const newMessageIds = await GmailIntegration.getHistory(credentials, lastHistoryId);

    // Update stored historyId for next notification
    await prisma.sourceConnection.update({
      where: { id: sourceConnection.id },
      data: {
        metadata: { ...storedMeta, lastHistoryId: historyId },
        lastSyncAt: new Date(),
      },
    });

    if (newMessageIds.length === 0) {
      return res.status(200).send('OK');
    }

    // Get the connected account email so we can skip outgoing messages
    const connectedEmail = storedMeta?.email || emailAddress;

    // Process each new email
    for (const msgId of newMessageIds) {
      try {
        const email = await GmailIntegration.getMessage(credentials, msgId);

        // Skip messages sent by the support account itself (outgoing replies)
        if (email.fromEmail.toLowerCase() === connectedEmail.toLowerCase()) {
          continue;
        }

        // Conversation threading: check for existing open ticket with same Gmail threadId
        const existingTicket = await prisma.ticket.findFirst({
          where: {
            organizationId: sourceConnection.organizationId,
            sourceId: sourceConnection.id,
            status: { in: ['open', 'in_progress'] },
            metadata: {
              path: ['emailThreadId'],
              equals: email.threadId,
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (existingTicket) {
          // Add message to existing ticket conversation
          await prisma.ticketMessage.create({
            data: {
              ticketId: existingTicket.id,
              senderType: 'customer',
              content: email.body,
            },
          });

          // Bump updatedAt
          await prisma.ticket.update({
            where: { id: existingTicket.id },
            data: {
              updatedAt: new Date(),
              metadata: {
                ...(existingTicket.metadata as any),
                emailLastMessageId: email.messageId,
              },
            },
          });

          // Re-trigger AI processing
          const organization = await prisma.organization.findUnique({
            where: { id: sourceConnection.organizationId },
            select: { settings: true },
          });
          const aiSettings = (organization?.settings as any)?.autonomousAI;
          if (aiSettings?.enabled && aiSettings?.autoResponseEnabled) {
            const { ticketProcessingQueue } = require('../config/queue');
            ticketProcessingQueue.add({
              ticketId: existingTicket.id,
              organizationId: sourceConnection.organizationId,
            });
          }

          logger.info(`Gmail: appended message to ticket ${existingTicket.id} (thread ${email.threadId})`);
        } else {
          // Create new ticket with email metadata
          const ticket = await prisma.ticket.create({
            data: {
              organizationId: sourceConnection.organizationId,
              sourceId: sourceConnection.id,
              customerName: email.fromName || email.fromEmail,
              customerEmail: email.fromEmail,
              subject: email.subject || 'No Subject',
              status: 'open',
              priority: 'medium',
              metadata: {
                source: 'gmail',
                emailThreadId: email.threadId,
                emailMessageId: email.messageId,
                emailLastMessageId: email.messageId,
                emailFrom: email.fromEmail,
                emailSubject: email.subject,
              },
              messages: {
                create: {
                  senderType: 'customer',
                  content: email.body,
                },
              },
            },
          });

          // Trigger AI processing if enabled
          const organization = await prisma.organization.findUnique({
            where: { id: sourceConnection.organizationId },
            select: { settings: true },
          });
          const aiSettings = (organization?.settings as any)?.autonomousAI;
          if (aiSettings?.enabled && aiSettings?.autoResponseEnabled) {
            const { ticketProcessingQueue } = require('../config/queue');
            ticketProcessingQueue.add({
              ticketId: ticket.id,
              organizationId: sourceConnection.organizationId,
            });
          }

          logger.info(`Gmail: created ticket ${ticket.id} from ${email.fromEmail} — "${email.subject}"`);
        }
      } catch (msgErr) {
        logger.error(`Gmail: failed to process message ${msgId}:`, msgErr);
        // Continue processing remaining messages
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    logger.error('Gmail webhook error:', error);
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
