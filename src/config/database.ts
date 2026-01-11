import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Create a standard connection pool using Supabase Session Pooler
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Prevent crashes on idle client errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
  // Don't exit process, let pool handle reconnection
});

const adapter = new PrismaPg(pool);

const prismaClient = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

// Ensure connection on startup
prismaClient.$connect()
  .then(() => {
    console.log('✓ Database connected successfully');
  })
  .catch((error: any) => {
    console.error('Failed to connect to database:', error);
    process.exit(1);
  });

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await prismaClient.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prismaClient.$disconnect();
  process.exit(0);
});

export default prismaClient;
