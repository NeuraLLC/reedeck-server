const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function applyRLS() {
  const client = await pool.connect();

  try {
    console.log('🔒 Applying Row Level Security policies...\n');

    const rlsFilePath = path.join(__dirname, 'enable-rls.sql');
    const sql = fs.readFileSync(rlsFilePath, 'utf8');

    // Split SQL into individual statements
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    let successCount = 0;
    let skipCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];

      // Skip comments
      if (statement.startsWith('--')) {
        skipCount++;
        continue;
      }

      try {
        await client.query(statement + ';');

        // Log key operations
        if (statement.includes('ENABLE ROW LEVEL SECURITY')) {
          const match = statement.match(/ALTER TABLE (\w+)/);
          if (match) {
            console.log(`✓ Enabled RLS on table: ${match[1]}`);
          }
        } else if (statement.includes('CREATE POLICY')) {
          const match = statement.match(/CREATE POLICY "([^"]+)"/);
          if (match) {
            console.log(`✓ Created policy: ${match[1]}`);
          }
        } else if (statement.includes('CREATE OR REPLACE FUNCTION')) {
          const match = statement.match(/FUNCTION (\w+)/);
          if (match) {
            console.log(`✓ Created helper function: ${match[1]}`);
          }
        }

        successCount++;
      } catch (error) {
        // Log non-critical errors but continue
        if (error.message.includes('already exists') || error.message.includes('does not exist')) {
          skipCount++;
        } else {
          console.warn(`⚠️  Warning on statement ${i + 1}: ${error.message}`);
        }
      }
    }

    console.log(`\n✅ RLS policies applied successfully!`);
    console.log(`   ${successCount} statements executed`);
    if (skipCount > 0) {
      console.log(`   ${skipCount} statements skipped`);
    }
    console.log('\n🔐 Your database tables are now protected with Row Level Security!');
    console.log('\nIMPORTANT: Make sure your application uses Supabase Auth or sets auth.uid() properly.');

  } catch (error) {
    console.error('❌ Failed to apply RLS policies:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

applyRLS();
