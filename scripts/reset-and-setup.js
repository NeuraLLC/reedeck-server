const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function resetAndSetup() {
  const client = await pool.connect();

  try {
    console.log('🗑️  Dropping existing tables...\n');

    const resetSQL = fs.readFileSync(
      path.join(__dirname, 'reset-database.sql'),
      'utf8'
    );

    await client.query(resetSQL);
    console.log('✓ All tables dropped successfully\n');

    console.log('Now run: npx prisma db push');
    console.log('This will create all tables from your Prisma schema.\n');

  } catch (error) {
    console.error('❌ Reset failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

resetAndSetup();
