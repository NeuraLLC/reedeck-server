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
 */
export async function sendResponseToSource(
  ticketId: string,
  responseText: string
): Promise<boolean> {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { metadata: true, sourceId: true },
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
          threadTs
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
        await DiscordIntegration.sendMessage(
          sourceConnection.credentials as string,
          metadata.discordChannelId,
          responseText
        );
        logger.info(
          `Response sent to Discord channel ${metadata.discordChannelId} for ticket ${ticketId}`
        );
        return true;
      }
      case 'telegram': {
        if (!metadata.telegramChatId) break;
        await TelegramIntegration.sendMessage(
          sourceConnection.credentials as string,
          metadata.telegramChatId,
          responseText
        );
        logger.info(
          `Response sent to Telegram chat ${metadata.telegramChatId} for ticket ${ticketId}`
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
