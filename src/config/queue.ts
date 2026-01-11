import Queue from 'bull';
import dotenv from 'dotenv';
import logger from './logger';

dotenv.config();

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86400 },
};


const REDIS_URL = process.env.REDIS_URL;

const redisOpts = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
  },
};

const createQueue = (name: string, overrides = {}) => {
  const options = {
    // If we have a URL, we don't spread redisOpts into here
    ...(REDIS_URL ? {} : redisOpts),
    // If using rediss:// (secure), ensure TLS is enabled.
    // Many cloud providers need rejectUnauthorized: false if certificates are self-signed or generic.
    ...(REDIS_URL && REDIS_URL.startsWith('rediss://') ? { 
      redis: { 
        tls: { rejectUnauthorized: false } 
      } 
    } : {}),
    defaultJobOptions: { ...defaultJobOptions, ...overrides },
  };

  if (REDIS_URL) {
    console.log(`[Queue: ${name}] Initializing with REDIS_URL...`);
  } else {
    console.log(`[Queue: ${name}] Initializing with REDIS_HOST: ${redisOpts.redis.host}`);
  }

  const queue = REDIS_URL 
    ? new Queue(name, REDIS_URL, options) 
    : new Queue(name, options);

  queue.on('ready', () => {
    console.log(`[Queue: ${name}] ✓ READY event received`);
    logger.info(`✓ Redis connected for queue: ${name}`);
  });

  queue.on('error', (error) => {
    console.error(`[Queue: ${name}] ✗ ERROR event:`, error);
    logger.error(`✗ Redis error for queue ${name}:`, error);
  });

  console.log(`[Queue: ${name}] Queue instance created`);
  return queue;
};

// create specific queues
export const ticketProcessingQueue = createQueue('ticket-processing');

export const emailQueue = createQueue('email-sending', {
  attempts: 5,
});

export const recurringIssueQueue = createQueue('recurring-issue-detection');

export const analyticsQueue = createQueue('analytics-aggregation', {
  attempts: 2,
});

export const queues = {
  ticketProcessing: ticketProcessingQueue,
  email: emailQueue,
  recurringIssue: recurringIssueQueue,
  analytics: analyticsQueue,
};

export default queues;