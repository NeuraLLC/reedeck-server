import prisma from '../config/database';
import logger from '../config/logger';

async function seedDatabase() {
  try {
    logger.info('Starting database seeding...');

    // Check if subscription plans already exist
    const existingPlans = await prisma.subscriptionPlan.count();

    if (existingPlans > 0) {
      logger.info('Subscription plans already exist. Skipping seed.');
      return;
    }

    // Create subscription plans
    await prisma.subscriptionPlan.createMany({
      data: [
        {
          name: 'Starter',
          priceMonthly: 50.00,
          channelsLimit: 3,
          messagesLimit: 10000,
          formsLimit: 2,
          aiAgentsLimit: 1,
          teammatesLimit: 5,
          chatHistoryDays: 7,
          features: {
            support: 'email',
            analytics: 'basic',
          },
        },
        {
          name: 'Professional',
          priceMonthly: 85.00,
          channelsLimit: 5,
          messagesLimit: 50000,
          formsLimit: 10,
          aiAgentsLimit: 3,
          teammatesLimit: 20,
          chatHistoryDays: 30,
          features: {
            support: 'priority',
            analytics: 'advanced',
            custom_branding: true,
            api_access: true,
          },
        },
        {
          name: 'Enterprise',
          priceMonthly: 118.00,
          channelsLimit: -1, // -1 means unlimited
          messagesLimit: -1,
          formsLimit: -1,
          aiAgentsLimit: -1,
          teammatesLimit: -1,
          chatHistoryDays: -1,
          features: {
            support: 'dedicated',
            analytics: 'advanced',
            custom_branding: true,
            api_access: true,
            white_label: true,
            sso: true,
            dedicated_manager: true,
          },
        },
      ],
    });

    logger.info('Subscription plans created successfully');
    logger.info('Database seeding completed!');
  } catch (error) {
    logger.error('Error seeding database:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seedDatabase()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
