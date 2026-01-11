import { recurringIssueQueue, analyticsQueue } from '../config/queue';
import prisma from '../config/database';
import logger from '../config/logger';

/**
 * Job Scheduler
 * Schedules periodic background jobs using Bull's repeat feature
 */

/**
 * Schedule recurring issue detection for all organizations
 * Runs weekly on Sunday at 2 AM
 */
export async function scheduleRecurringIssueDetection() {
  try {
    // Get all organizations with autonomous AI enabled
    const organizations = await prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        settings: true,
      },
    });

    for (const org of organizations) {
      const aiSettings = (org.settings as any)?.autonomousAI;

      if (aiSettings?.enabled && aiSettings?.recurringIssueDetection) {
        // Schedule weekly recurring issue detection
        await recurringIssueQueue.add(
          'weekly-detection',
          {
            organizationId: org.id,
            autoCreateTasks: aiSettings.autoCreateTasks || false,
          },
          {
            repeat: {
              cron: '0 2 * * 0', // Sunday at 2 AM
            },
            jobId: `recurring-issues-${org.id}`, // Prevent duplicates
          }
        );

        logger.info(`Scheduled weekly recurring issue detection for organization ${org.name}`);
      }
    }

    logger.info('Recurring issue detection jobs scheduled successfully');
  } catch (error) {
    logger.error('Error scheduling recurring issue detection:', error);
  }
}

/**
 * Schedule daily analytics aggregation for all organizations
 * Runs every day at 1 AM
 */
export async function scheduleDailyAnalytics() {
  try {
    const organizations = await prisma.organization.findMany({
      select: {
        id: true,
        name: true,
      },
    });

    for (const org of organizations) {
      // Schedule daily analytics
      await analyticsQueue.add(
        'daily-analytics',
        {
          organizationId: org.id,
          type: 'daily',
        },
        {
          repeat: {
            cron: '0 1 * * *', // Every day at 1 AM
          },
          jobId: `daily-analytics-${org.id}`,
        }
      );
    }

    logger.info(`Scheduled daily analytics for ${organizations.length} organizations`);
  } catch (error) {
    logger.error('Error scheduling daily analytics:', error);
  }
}

/**
 * Schedule weekly analytics aggregation for all organizations
 * Runs every Monday at 3 AM
 */
export async function scheduleWeeklyAnalytics() {
  try {
    const organizations = await prisma.organization.findMany({
      select: {
        id: true,
        name: true,
      },
    });

    for (const org of organizations) {
      // Schedule weekly analytics
      await analyticsQueue.add(
        'weekly-analytics',
        {
          organizationId: org.id,
          type: 'weekly',
        },
        {
          repeat: {
            cron: '0 3 * * 1', // Monday at 3 AM
          },
          jobId: `weekly-analytics-${org.id}`,
        }
      );
    }

    logger.info(`Scheduled weekly analytics for ${organizations.length} organizations`);
  } catch (error) {
    logger.error('Error scheduling weekly analytics:', error);
  }
}

/**
 * Schedule monthly analytics aggregation for all organizations
 * Runs on the 1st of each month at 4 AM
 */
export async function scheduleMonthlyAnalytics() {
  try {
    const organizations = await prisma.organization.findMany({
      select: {
        id: true,
        name: true,
      },
    });

    for (const org of organizations) {
      // Schedule monthly analytics
      await analyticsQueue.add(
        'monthly-analytics',
        {
          organizationId: org.id,
          type: 'monthly',
        },
        {
          repeat: {
            cron: '0 4 1 * *', // 1st of month at 4 AM
          },
          jobId: `monthly-analytics-${org.id}`,
        }
      );
    }

    logger.info(`Scheduled monthly analytics for ${organizations.length} organizations`);
  } catch (error) {
    logger.error('Error scheduling monthly analytics:', error);
  }
}

/**
 * Initialize all scheduled jobs
 * Call this when the application starts
 */
export async function initializeScheduledJobs() {
  logger.info('Initializing scheduled jobs...');

  await Promise.all([
    scheduleRecurringIssueDetection(),
    scheduleDailyAnalytics(),
    scheduleWeeklyAnalytics(),
    scheduleMonthlyAnalytics(),
  ]);

  logger.info('All scheduled jobs initialized successfully');
}

// Run scheduler if this file is executed directly
if (require.main === module) {
  initializeScheduledJobs()
    .then(() => {
      logger.info('Scheduler initialized');
    })
    .catch((error) => {
      logger.error('Error initializing scheduler:', error);
      process.exit(1);
    });
}
