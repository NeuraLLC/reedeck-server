import prisma from '../config/database';
import logger from '../config/logger';

/**
 * Check if the given email belongs to an active member of the specified organization.
 * Used by webhook handlers to skip ticket creation for internal (team) messages.
 */
export async function isOrganizationMember(
  organizationId: string,
  email: string,
  options?: { telegramUsername?: string }
): Promise<boolean> {
  // Primary check: match by email
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

  // Telegram fallback: match username against email prefix
  if (options?.telegramUsername) {
    const memberByUsername = await prisma.organizationMember.findFirst({
      where: {
        organizationId,
        status: 'active',
        user: {
          email: { startsWith: options.telegramUsername, mode: 'insensitive' },
        },
      },
      select: { id: true },
    });

    if (memberByUsername) {
      logger.info(`[TEAM FILTER] Telegram @${options.telegramUsername} matches org member, skipping ticket`);
      return true;
    }
  }

  return false;
}
