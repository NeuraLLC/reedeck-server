/**
 * Discord Message Processor
 *
 * Extracted from the webhook handler so it can be called by both
 * the HTTP webhook endpoint and the Discord Gateway bot worker.
 */

import prisma from '../config/database';
import logger from '../config/logger';
import { supabaseAdmin } from '../config/supabase';
import { DiscordIntegration } from './integrations/discord';
import { isOrganizationMember } from './teamMemberFilter';

interface DiscordMessage {
  id: string;
  content: string;
  channel_id: string;
  author: {
    id: string;
    username: string;
    bot?: boolean;
  };
}

/**
 * Process an incoming Discord message — creates or updates a ticket.
 * Returns true if the message was processed successfully.
 */
export async function processDiscordMessage(
  message: DiscordMessage,
  guildId: string
): Promise<boolean> {
  try {
    // Filter: only process actual user messages (not bots)
    if (!message.content || !message.author || message.author.bot) {
      logger.debug('[DISCORD] Message filtered out (bot or no content)');
      return false;
    }

    logger.info('[DISCORD] Processing message', {
      channelId: message.channel_id,
      authorId: message.author.id,
    });

    // Find the source connection for this Discord guild
    const sourceConnection = await prisma.sourceConnection.findFirst({
      where: {
        sourceType: {
          equals: 'Discord',
          mode: 'insensitive',
        },
        metadata: {
          path: ['guilds'],
          array_contains: [{ id: guildId }],
        },
        isActive: true,
      },
    });

    if (!sourceConnection) {
      logger.warn('[DISCORD] No source connection found for guildId:', guildId);
      return false;
    }

    logger.info('[DISCORD] Source connection found:', sourceConnection.id);

    // Enrich user info from Discord API
    let customerName = message.author.username;
    let customerEmail = `${message.author.id}@discord.local`;
    try {
      const userInfo = await DiscordIntegration.getUserInfo(
        sourceConnection.credentials as string,
        message.author.id
      );
      customerName = `${userInfo.username}#${userInfo.discriminator}`;
      customerEmail = userInfo.email || `${message.author.id}@discord.local`;
    } catch (err) {
      logger.error('[DISCORD] Failed to fetch user info:', err);
    }

    // Team member filter: skip ticket creation for internal messages
    if (await isOrganizationMember(sourceConnection.organizationId, customerEmail, { discordId: message.author.id })) {
      return false;
    }

    // Get channel name for subject
    let channelName = message.channel_id;
    try {
      const channelInfo = await DiscordIntegration.getChannelInfo(
        sourceConnection.credentials as string,
        message.channel_id
      );
      channelName = channelInfo.name;
    } catch (err) {
      // Keep channel ID as fallback
    }

    // Conversation threading: check for an existing open ticket from the same user in the same channel
    const existingTicket = await prisma.ticket.findFirst({
      where: {
        organizationId: sourceConnection.organizationId,
        sourceId: sourceConnection.id,
        customerEmail,
        status: { in: ['open', 'in_progress'] },
        metadata: {
          path: ['discordChannelId'],
          equals: message.channel_id,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingTicket) {
      logger.info('[DISCORD] Found existing ticket:', existingTicket.id);

      // Add message to existing ticket with per-message Discord message ID
      await prisma.ticketMessage.create({
        data: {
          ticketId: existingTicket.id,
          senderType: 'customer',
          content: message.content,
          metadata: { discordMessageId: message.id },
        },
      });

      // Update ticket metadata with latest message ID so replies target the newest message
      const existingMeta = (existingTicket.metadata as any) || {};
      await prisma.ticket.update({
        where: { id: existingTicket.id },
        data: {
          updatedAt: new Date(),
          metadata: { ...existingMeta, discordMessageId: message.id },
        },
      });

      // Broadcast realtime event for dashboard
      supabaseAdmin.channel(`org:${sourceConnection.organizationId}`).send({
        type: 'broadcast',
        event: 'ticket_updated',
        payload: { ticketId: existingTicket.id },
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
      logger.info('[DISCORD] Creating new ticket...');

      // Create new ticket with Discord metadata for return communication
      const ticket = await prisma.ticket.create({
        data: {
          organizationId: sourceConnection.organizationId,
          sourceId: sourceConnection.id,
          customerName,
          customerEmail,
          subject: `Discord message from #${channelName}`,
          status: 'open',
          priority: 'medium',
          metadata: {
            source: 'discord',
            discordChannelId: message.channel_id,
            discordUserId: message.author.id,
            discordGuildId: guildId,
            discordMessageId: message.id,
          },
          messages: {
            create: {
              senderType: 'customer',
              content: message.content,
              metadata: { discordMessageId: message.id },
            },
          },
        },
      });
      logger.info('[DISCORD] Ticket created:', ticket.id);

      // Broadcast realtime event for dashboard
      supabaseAdmin.channel(`org:${sourceConnection.organizationId}`).send({
        type: 'broadcast',
        event: 'ticket_created',
        payload: { ticketId: ticket.id },
      });

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

    return true;
  } catch (error) {
    logger.error('[DISCORD] Error processing message:', error);
    return false;
  }
}
