import { Job } from 'bull';
import { recurringIssueQueue } from '../config/queue';
import autonomousAIService from '../services/autonomousAIService';
import prisma from '../config/database';
import logger from '../config/logger';

interface RecurringIssueDetectionJob {
  organizationId: string;
  autoCreateTasks?: boolean;
}

/**
 * Detect recurring issues from tickets
 * This is a heavy operation that should run in the background
 */
recurringIssueQueue.process(async (job: Job<RecurringIssueDetectionJob>) => {
  const { organizationId, autoCreateTasks = false } = job.data;

  logger.info(`Detecting recurring issues for organization ${organizationId}`);

  try {
    // Detect recurring issues
    const issues = await autonomousAIService.detectRecurringIssues(organizationId);

    logger.info(`Found ${issues.length} recurring issues for organization ${organizationId}`);

    // Get organization settings
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    const aiSettings = (organization?.settings as any)?.autonomousAI || {};

    // Auto-create tasks if enabled and requested
    if (autoCreateTasks && aiSettings.autoCreateTasks && aiSettings.taskPlatform) {
      logger.info(`Auto-creating tasks for ${issues.length} recurring issues`);

      const createdTasks = [];

      for (const issue of issues) {
        // Only create tasks for issues above minimum threshold
        if (issue.occurrences >= (aiSettings.minimumOccurrences || 3)) {
          try {
            let task;

            if (aiSettings.taskPlatform === 'clickup') {
              task = await autonomousAIService.createClickUpTask(
                organizationId,
                issue
              );
            } else if (aiSettings.taskPlatform === 'asana') {
              task = await autonomousAIService.createAsanaTask(
                organizationId,
                issue
              );
            }

            if (task) {
              createdTasks.push(task);
              logger.info(`Created task for issue: ${issue.issue}`);
            }
          } catch (error) {
            logger.error(`Error creating task for issue "${issue.issue}":`, error);
            // Continue with other issues
          }
        }
      }

      logger.info(`Created ${createdTasks.length} tasks for recurring issues`);

      return {
        success: true,
        issuesDetected: issues.length,
        tasksCreated: createdTasks.length,
        tasks: createdTasks,
      };
    }

    return {
      success: true,
      issuesDetected: issues.length,
      issues,
    };
  } catch (error) {
    logger.error(`Error detecting recurring issues for organization ${organizationId}:`, error);
    throw error; // Will trigger retry
  }
});

// Error handler
recurringIssueQueue.on('error', (error) => {
  logger.error('Recurring issue queue error:', error);
});

// Failed job handler
recurringIssueQueue.on('failed', (job, error) => {
  logger.error(`Recurring issue job ${job.id} failed:`, error);
});

// Completed job handler
recurringIssueQueue.on('completed', (job, result) => {
  logger.info(`Recurring issue job ${job.id} completed: ${result.issuesDetected} issues detected`);
});

logger.info('Recurring issue detection worker started');

export default recurringIssueQueue;
