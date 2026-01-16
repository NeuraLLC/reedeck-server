import 'dotenv/config';
import prisma from '../config/database';
import logger from '../config/logger';

async function setupOrganization() {
  const userId = 'afaee353-c11e-4606-92e7-66f702d5f6e0';
  const organizationName = 'Emmy Organization';

  try {
    logger.info('Setting up organization...');

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      logger.error(`User with ID ${userId} not found`);
      return;
    }

    // Check if user already has an organization
    const existingMembership = await prisma.organizationMember.findFirst({
      where: { userId },
    });

    if (existingMembership) {
      logger.error('User already belongs to an organization');
      return;
    }

    // Get the Starter plan
    const starterPlan = await prisma.subscriptionPlan.findUnique({
      where: { name: 'Starter' },
    });

    if (!starterPlan) {
      logger.error('Starter plan not found. Please run seed first.');
      return;
    }

    // Create everything in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create subscription (active, 1 year)
      const subscription = await tx.subscription.create({
        data: {
          planId: starterPlan.id,
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
          cancelAtPeriodEnd: false,
        },
      });

      // 2. Create organization
      const slug = organizationName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      const organization = await tx.organization.create({
        data: {
          name: organizationName,
          slug: `${slug}-${subscription.id.substring(0, 8)}`,
          subscriptionId: subscription.id,
          settings: {},
        },
      });

      // 3. Create organization membership (admin)
      const membership = await tx.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: userId,
          role: 'admin',
          status: 'active',
        },
      });

      // 4. Initialize usage tracking
      const currentPeriod = new Date().toISOString().slice(0, 7); // YYYY-MM
      const usageTracking = await tx.usageTracking.create({
        data: {
          subscriptionId: subscription.id,
          period: currentPeriod,
          channelsUsed: 0,
          messagesUsed: 0,
          formsUsed: 0,
          aiAgentsUsed: 0,
          teammatesUsed: 1,
        },
      });

      return { subscription, organization, membership, usageTracking };
    });

    logger.info('Organization setup completed successfully!');
    logger.info(`Organization ID: ${result.organization.id}`);
    logger.info(`Organization Slug: ${result.organization.slug}`);
    logger.info(`Subscription ID: ${result.subscription.id}`);
    logger.info(`User ${user.email} is now admin of ${organizationName}`);
  } catch (error) {
    logger.error('Error setting up organization:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

setupOrganization()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
