import { Job } from 'bull';
import { emailQueue } from '../config/queue';
import { sendInvitationEmail } from '../services/emailService';
import logger from '../config/logger';

interface InvitationEmailJob {
  toEmail: string;
  organizationName: string;
  inviterName: string;
  role: string;
  token: string;
}

interface GenericEmailJob {
  type: 'invitation' | 'notification' | 'alert' | 'welcome';
  data: any;
}

/**
 * Process email sending jobs
 * Handles various types of emails asynchronously
 */
emailQueue.process(async (job: Job<GenericEmailJob>) => {
  const { type, data } = job.data;

  logger.info(`Processing email job: ${type}`);

  try {
    switch (type) {
      case 'invitation':
        await sendInvitationEmail(data as InvitationEmailJob);
        logger.info(`Invitation email sent to ${data.toEmail}`);
        break;

      case 'notification':
        // TODO: Implement notification emails (ticket updates, mentions, etc.)
        logger.info(`Notification email sent to ${data.toEmail}`);
        break;

      case 'alert':
        // TODO: Implement alert emails (urgent tickets, system issues, etc.)
        logger.info(`Alert email sent to ${data.toEmail}`);
        break;

      case 'welcome':
        // TODO: Implement welcome emails (new user onboarding)
        logger.info(`Welcome email sent to ${data.toEmail}`);
        break;

      default:
        throw new Error(`Unknown email type: ${type}`);
    }

    return {
      success: true,
      type,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(`Error sending email (${type}):`, error);
    throw error; // Will trigger retry
  }
});

// Error handler
emailQueue.on('error', (error) => {
  logger.error('Email queue error:', error);
});

// Failed job handler
emailQueue.on('failed', (job, error) => {
  logger.error(`Email job ${job.id} failed after ${job.attemptsMade} attempts:`, error);
  // TODO: Alert admin about failed email
});

// Completed job handler
emailQueue.on('completed', (job, result) => {
  logger.info(`Email job ${job.id} completed successfully`);
});

// Stalled job handler (job took too long)
emailQueue.on('stalled', (job) => {
  logger.warn(`Email job ${job.id} has stalled`);
});

logger.info('Email processing worker started');

export default emailQueue;
