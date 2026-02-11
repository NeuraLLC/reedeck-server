/**
 * Channel Relay Service
 *
 * Sends agent responses back to the original source platform (Slack, Gmail, etc.)
 * Only called when a human agent explicitly sends a reply — AI draft responses
 * stay internal until an agent approves and sends them.
 */

import prisma from '../config/database';
import logger from '../config/logger';
import { SlackIntegration } from './integrations/slack';
import { GmailIntegration } from './integrations/gmail';
import { DiscordIntegration } from './integrations/discord';
import { TelegramIntegration } from './integrations/telegram';

/**
 * Send a message back to the source platform the ticket originated from.
 * Looks up ticket metadata to determine platform and channel, then delivers the message.
 * When senderUserId is provided, the reply is branded with the organization name + agent name.
 */
export async function sendResponseToSource(
  ticketId: string,
  responseText: string,
  senderUserId?: string | null
): Promise<boolean> {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { metadata: true, sourceId: true, organizationId: true },
    });

    if (!ticket?.sourceId) return false;

    const metadata = ticket.metadata as any;
    if (!metadata?.source) return false;

    // Get the source connection credentials
    const sourceConnection = await prisma.sourceConnection.findUnique({
      where: { id: ticket.sourceId },
      select: { credentials: true, sourceType: true },
    });

    if (!sourceConnection) return false;

    // Fetch organization branding
    let brandName: string | undefined;
    let brandAvatarUrl: string | undefined;
    let agentDisplayName: string | undefined;

    if (ticket.organizationId) {
      const org = await prisma.organization.findUnique({
        where: { id: ticket.organizationId },
        select: { name: true, avatarUrl: true },
      });
      if (org?.name) {
        brandName = org.name;
        brandAvatarUrl = org.avatarUrl || undefined;
      }
    }

    // Fetch agent name if a human agent is sending
    if (senderUserId) {
      const agent = await prisma.user.findUnique({
        where: { id: senderUserId },
        select: { firstName: true, lastName: true },
      });
      if (agent?.firstName) {
        agentDisplayName = agent.lastName
          ? `${agent.firstName} ${agent.lastName}`
          : agent.firstName;
      }
    }

    // Build the display name: "Acme Corp (via Sarah)" or just "Acme Corp"
    let displayName: string | undefined;
    if (brandName) {
      displayName = agentDisplayName
        ? `${brandName} (via ${agentDisplayName})`
        : brandName;
    }

    switch (metadata.source) {
      case 'slack': {
        if (!metadata.slackChannelId) break;

        // Find the most recent customer message with a Slack ts so the reply
        // appears under the correct thread on Slack (not the original message).
        const latestCustomerMsg = await prisma.ticketMessage.findFirst({
          where: {
            ticketId,
            senderType: 'customer',
            metadata: { path: ['slackMessageTs'], not: 'null' },
          },
          orderBy: { createdAt: 'desc' },
          select: { metadata: true },
        });

        const threadTs =
          (latestCustomerMsg?.metadata as any)?.slackMessageTs ||
          metadata.slackMessageTs;

        await SlackIntegration.sendMessage(
          sourceConnection.credentials as string,
          metadata.slackChannelId,
          responseText,
          threadTs,
          displayName ? { username: displayName, iconUrl: brandAvatarUrl } : undefined
        );
        logger.info(
          `Response sent to Slack channel ${metadata.slackChannelId} (thread ${threadTs}) for ticket ${ticketId}`
        );
        return true;
      }
      case 'gmail': {
        if (!metadata.emailFrom || !metadata.emailSubject) break;

        // Refresh token before sending
        let credentials = sourceConnection.credentials as string;
        try {
          credentials = await GmailIntegration.refreshAccessToken(credentials);
          await prisma.sourceConnection.update({
            where: { id: ticket.sourceId! },
            data: { credentials },
          });
        } catch (refreshErr) {
          logger.warn('Gmail token refresh failed, trying with existing token:', refreshErr);
        }

        const result = await GmailIntegration.replyToEmail(
          credentials,
          metadata.emailFrom,          // Reply to the customer's email
          metadata.emailSubject,        // Preserves original subject
          responseText,
          metadata.emailThreadId,       // Thread the reply in Gmail
          metadata.emailMessageId       // In-Reply-To header for proper threading
        );

        // Store the new messageId so future replies chain correctly
        await prisma.ticket.update({
          where: { id: ticketId },
          data: {
            metadata: {
              ...metadata,
              emailLastMessageId: result.messageId,
            },
          },
        });

        logger.info(
          `Response sent via Gmail to ${metadata.emailFrom} for ticket ${ticketId}`
        );
        return true;
      }
      case 'discord': {
        if (!metadata.discordChannelId) break;

        // Find the most recent customer message with a Discord message ID so the
        // reply appears as a reply to the correct message on Discord.
        const latestDiscordMsg = await prisma.ticketMessage.findFirst({
          where: {
            ticketId,
            senderType: 'customer',
            metadata: { path: ['discordMessageId'], not: 'null' },
          },
          orderBy: { createdAt: 'desc' },
          select: { metadata: true },
        });

        const replyToMessageId =
          (latestDiscordMsg?.metadata as any)?.discordMessageId ||
          metadata.discordMessageId;

        const discordText = displayName
          ? `**${displayName}**\n${responseText}`
          : responseText;

        await DiscordIntegration.sendMessage(
          sourceConnection.credentials as string,
          metadata.discordChannelId,
          discordText,
          replyToMessageId
        );
        logger.info(
          `Response sent to Discord channel ${metadata.discordChannelId} (reply to ${replyToMessageId}) for ticket ${ticketId}`
        );
        return true;
      }
      case 'telegram': {
        if (!metadata.telegramChatId) break;

        // Find the most recent customer message with a Telegram message ID so the
        // reply appears as a reply to the correct message.
        const latestTelegramMsg = await prisma.ticketMessage.findFirst({
          where: {
            ticketId,
            senderType: 'customer',
            metadata: { path: ['telegramMessageId'], not: 'null' },
          },
          orderBy: { createdAt: 'desc' },
          select: { metadata: true },
        });

        const replyToTelegramId =
          (latestTelegramMsg?.metadata as any)?.telegramMessageId ||
          metadata.telegramMessageId;

        const telegramText = displayName
          ? `<b>${displayName}</b>\n${responseText}`
          : responseText;

        await TelegramIntegration.sendMessage(
          sourceConnection.credentials as string,
          metadata.telegramChatId,
          telegramText,
          replyToTelegramId
        );
        logger.info(
          `Response sent to Telegram chat ${metadata.telegramChatId} (reply to ${replyToTelegramId}) for ticket ${ticketId}`
        );
        return true;
      }
    }

    return false;
  } catch (error) {
    logger.error(
      `Failed to send response to source for ticket ${ticketId}:`,
      error
    );
    // Don't throw — the response is saved in DB regardless
    return false;
  }
}
