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
  origin: [process.env.FRONTEND_URL || process.env.ADMIN_URL || 'http://localhost:3000', 'http://localhost:3001'],
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

// Temporary endpoint to seed subscription plans
app.post('/seed-plans', async (req, res) => {
  try {
    const existingPlans = await prismaClient.subscriptionPlan.count();
    if (existingPlans > 0) {
      return res.json({ message: 'Plans already exist', count: existingPlans });
    }

    await prismaClient.subscriptionPlan.createMany({
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
          features: { support: 'email', analytics: 'basic' },
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
          features: { support: 'priority', analytics: 'advanced', custom_branding: true, api_access: true },
        },
        {
          name: 'Enterprise',
          priceMonthly: 118.00,
          channelsLimit: -1,
          messagesLimit: -1,
          formsLimit: -1,
          aiAgentsLimit: -1,
          teammatesLimit: -1,
          chatHistoryDays: -1,
          features: { support: 'dedicated', analytics: 'advanced', custom_branding: true, api_access: true, white_label: true, sso: true, dedicated_manager: true },
        },
      ],
    });

    res.json({ message: 'Subscription plans created successfully', count: 3 });
  } catch (error) {
    logger.error('Seed plans error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Temporary endpoint to create demo_requests table
app.post('/create-demo-table', async (req, res) => {
  try {
    await prismaClient.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS demo_requests (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL,
        organization_name TEXT NOT NULL,
        team_size TEXT,
        use_case TEXT,
        status TEXT NOT NULL DEFAULT 'submitted',
        demo_booked_at TIMESTAMP,
        demo_completed_at TIMESTAMP,
        converted_user_id TEXT,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await prismaClient.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_demo_requests_email ON demo_requests(email)`);
    await prismaClient.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_demo_requests_status ON demo_requests(status)`);

    res.json({ message: 'demo_requests table created successfully' });
  } catch (error) {
    logger.error('Create table error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Endpoint to enable RLS on demo_requests table
app.post('/enable-demo-rls', async (req, res) => {
  try {
    // Enable RLS on the table
    await prismaClient.$executeRawUnsafe(`ALTER TABLE demo_requests ENABLE ROW LEVEL SECURITY`);

    // Drop existing policies if they exist
    await prismaClient.$executeRawUnsafe(`DROP POLICY IF EXISTS "Allow public insert" ON demo_requests`);
    await prismaClient.$executeRawUnsafe(`DROP POLICY IF EXISTS "Service role full access" ON demo_requests`);

    // Allow anyone to INSERT (submit demo requests)
    await prismaClient.$executeRawUnsafe(`
      CREATE POLICY "Allow public insert"
      ON demo_requests
      FOR INSERT
      TO anon, authenticated
      WITH CHECK (true)
    `);

    // Service role (our backend) has full access and bypasses RLS
    // No need for explicit SELECT/UPDATE/DELETE policies for public
    // This means only our backend can read/update/delete demo requests

    logger.info('RLS enabled on demo_requests table');
    res.json({
      message: 'RLS enabled successfully on demo_requests table',
      policies: [
        'Public can INSERT (submit demo requests)',
        'Service role has full access (backend only)',
        'Public cannot SELECT/UPDATE/DELETE (prevents data exposure)'
      ]
    });
  } catch (error) {
    logger.error('Enable RLS error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
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
  });
}

export default app;
