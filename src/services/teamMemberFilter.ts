import prisma from '../config/database';
import logger from '../config/logger';

/**
 * Check if the sender belongs to an active member of the specified organization.
 * Used by webhook handlers to skip ticket creation for internal (team) messages.
 *
 * Matching strategy per platform:
 *   Slack    – real email from API → email match; fallback to linked slackId
 *   Discord  – linked discordId → direct match; fallback to email
 *   Telegram – linked telegramUsername → direct match; fallback to email
 */
export async function isOrganizationMember(
  organizationId: string,
  email: string,
  options?: { telegramUsername?: string; discordId?: string; slackId?: string }
): Promise<boolean> {
  // 1. Primary: match by email (works for Slack and any platform with real email)
  const memberByEmail = await prisma.organizationMember.findFirst({
    where: {
      organizationId,
      status: 'active',
      user: {
        email: { equals: email, mode: 'insensitive' },
      },
    },
    select: { id: true },
  });

  if (memberByEmail) {
    logger.info(`[TEAM FILTER] Sender ${email} is an org member, skipping ticket`);
    return true;
  }

  // 2. Telegram: match by linked telegramUsername
  if (options?.telegramUsername) {
    const memberByTelegram = await prisma.organizationMember.findFirst({
      where: {
        organizationId,
        status: 'active',
        user: {
          telegramUsername: { equals: options.telegramUsername, mode: 'insensitive' },
        },
      },
      select: { id: true },
    });

    if (memberByTelegram) {
      logger.info(`[TEAM FILTER] Telegram @${options.telegramUsername} matches org member, skipping ticket`);
      return true;
    }
  }

  // 3. Discord: match by linked discordId
  if (options?.discordId) {
    const memberByDiscord = await prisma.organizationMember.findFirst({
      where: {
        organizationId,
        status: 'active',
        user: {
          discordId: options.discordId,
        },
      },
      select: { id: true },
    });

    if (memberByDiscord) {
      logger.info(`[TEAM FILTER] Discord ${options.discordId} matches org member, skipping ticket`);
      return true;
    }
  }

  // 4. Slack: match by linked slackId
  if (options?.slackId) {
    const memberBySlack = await prisma.organizationMember.findFirst({
      where: {
        organizationId,
        status: 'active',
        user: {
          slackId: options.slackId,
        },
      },
      select: { id: true },
    });

    if (memberBySlack) {
      logger.info(`[TEAM FILTER] Slack ${options.slackId} matches org member, skipping ticket`);
      return true;
    }
  }

  return false;
}
