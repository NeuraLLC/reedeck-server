import 'dotenv/config';
/**
 * Worker Initialization
 * This file imports all workers and starts them
 * Run this as a separate process: `ts-node src/workers/index.ts`
 */

import logger from '../config/logger';
import { initializeScheduledJobs } from './scheduler';

// Import all workers (this starts them)
import './ticketProcessor';
import './emailProcessor';
import './recurringIssueProcessor';
import './analyticsProcessor';

logger.info('All background workers initialized successfully');

// Auto-initialize scheduled jobs (cron jobs)
initializeScheduledJobs()
  .then(() => {
    logger.info('Scheduled jobs initialized automatically');
  })
  .catch((error) => {
    logger.error('Failed to initialize scheduled jobs:', error);
    logger.warn('Workers will continue running, but scheduled jobs may not be active');
  });

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing workers gracefully');

  const { queues } = await import('../config/queue');

  await Promise.all([
    queues.ticketProcessing.close(),
    queues.email.close(),
    queues.recurringIssue.close(),
    queues.analytics.close(),
  ]);

  logger.info('All workers closed');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT signal received: closing workers gracefully');

  const { queues } = await import('../config/queue');

  await Promise.all([
    queues.ticketProcessing.close(),
    queues.email.close(),
    queues.recurringIssue.close(),
    queues.analytics.close(),
  ]);

  logger.info('All workers closed');
  process.exit(0);
});
