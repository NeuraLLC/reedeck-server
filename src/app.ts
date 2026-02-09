import 'dotenv/config';
import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import logger from './config/logger';
import prismaClient from './config/database';
import { errorHandler } from './middleware/errorHandler';
import {
  apiLimiter,
  speedLimiter,
  burstDetection,
  ddosProtection,
  patternAnalysis,
} from './middleware/security';
import { ipBlacklistMiddleware } from './middleware/ipBlacklist';
import { authContextMiddleware } from './middleware/authContext';

// Import routes
import authRoutes from './routes/auth';
import organizationsRoutes from './routes/organizations';
import subscriptionsRoutes from './routes/subscriptions';
import ticketsRoutes from './routes/tickets';
import aiAgentsRoutes from './routes/aiAgents';
import formsRoutes from './routes/forms';
import adminRoutes from './routes/admin';
import superAdminRoutes from './routes/superAdmin';
import invitationsRoutes from './routes/invitations';
import userRoutes from './routes/user';
import analyticsRoutes from './routes/analytics';
import integrationsRoutes from './routes/integrations';
import webhooksRoutes from './routes/webhooks';
import publicFormsRoutes from './routes/publicForms';
import autonomousAIRoutes from './routes/autonomousAI';
import demoRoutes from './routes/demo';
import widgetRoutes from './routes/widget';
import uploadsRoutes from './routes/uploads';

// Load environment variables
// Load environment variables

const app: Application = express();
const PORT = process.env.PORT || 5000;

// Security middleware (apply early)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

// CORS configuration
app.use(cors({
  origin: [
    process.env.FRONTEND_URL,
    process.env.ADMIN_URL,
    'http://localhost:3000',
    'http://localhost:3001',
  ].filter(Boolean) as string[],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-organization-id'],
  maxAge: 86400, // 24 hours
}));

// Trust proxy (important for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Auth context middleware (MUST be first to enable RLS)
app.use(authContextMiddleware);

// IP blacklist check (must be early)
app.use(ipBlacklistMiddleware);

// DDoS protection and burst detection
app.use(ddosProtection);
app.use(burstDetection);
app.use(patternAnalysis);

// Body parser - use raw for Stripe webhooks
app.use('/api/subscriptions/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// Health check (no rate limiting)
app.get('/health', async (req, res) => {
  try {
    // Test database connection with actual query
    const dbCheck = await prismaClient.$queryRaw`SELECT 1 as result`;
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
      dbCheck
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});


// Apply speed limiter and general rate limiter to all API routes
app.use('/api', speedLimiter);
app.use('/api', apiLimiter);

// Webhook routes (no authentication, uses signature verification)
app.use('/api/integrations/webhooks', webhooksRoutes);

// Public routes (no rate limiting needed, handled internally)
app.use('/api/public/forms', publicFormsRoutes);
app.use('/api/demo', demoRoutes);
app.use('/api/widget', widgetRoutes);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/organizations', organizationsRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
app.use('/api/tickets', ticketsRoutes);
app.use('/api/ai-agents', aiAgentsRoutes);
app.use('/api/forms', formsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/invitations', invitationsRoutes);
app.use('/api/user', userRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/autonomous-ai', autonomousAIRoutes);
app.use('/api/uploads', uploadsRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler (must be last)
app.use(errorHandler);

// Start server
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV}`);

    // Start background workers in the same process
    import('./workers/index')
      .then(() => logger.info('Background workers started in-process'))
      .catch((err) => logger.error('Failed to start background workers:', err));
  });
}

export default app;
