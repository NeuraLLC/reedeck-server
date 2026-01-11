const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function verifyRLS() {
  const client = await pool.connect();

  try {
    console.log('🔍 Verifying Row Level Security Setup...\n');

    // Check if RLS is enabled on all tables
    console.log('1️⃣  Checking RLS status on tables:');
    const rlsStatus = await client.query(`
      SELECT
        tablename,
        CASE WHEN rowsecurity THEN '✅ Enabled' ELSE '❌ Disabled' END as rls_status
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);

    rlsStatus.rows.forEach(row => {
      console.log(`   ${row.tablename.padEnd(30)} ${row.rls_status}`);
    });

    // Count policies
    console.log('\n2️⃣  Checking RLS policies:');
    const policiesCount = await client.query(`
      SELECT
        schemaname,
        tablename,
        COUNT(*) as policy_count
      FROM pg_policies
      WHERE schemaname = 'public'
      GROUP BY schemaname, tablename
      ORDER BY tablename;
    `);

    let totalPolicies = 0;
    policiesCount.rows.forEach(row => {
      console.log(`   ${row.tablename.padEnd(30)} ${row.policy_count} policies`);
      totalPolicies += parseInt(row.policy_count);
    });

    console.log(`\n   Total policies: ${totalPolicies}`);

    // Check if auth functions exist
    console.log('\n3️⃣  Checking helper functions:');
    const functions = await client.query(`
      SELECT
        proname as function_name
      FROM pg_proc
      WHERE proname IN ('is_organization_member', 'is_organization_admin', 'get_user_organizations')
      ORDER BY proname;
    `);

    const functionNames = ['is_organization_member', 'is_organization_admin', 'get_user_organizations'];
    const existingFunctions = functions.rows.map(f => f.function_name);

    functionNames.forEach(name => {
      const status = existingFunctions.includes(name) ? '✅ Exists' : '❌ Missing';
      console.log(`   ${name.padEnd(30)} ${status}`);
    });

    // Test auth.uid()
    console.log('\n4️⃣  Testing auth.uid() function:');
    try {
      await client.query(`SELECT set_config('request.jwt.claims', '{"sub":"test-user-id"}', true);`);
      const result = await client.query(`SELECT auth.uid() as user_id;`);

      if (result.rows[0].user_id === 'test-user-id') {
        console.log('   ✅ auth.uid() is working correctly');
      } else {
        console.log('   ❌ auth.uid() returned unexpected value:', result.rows[0].user_id);
      }
    } catch (error) {
      console.log('   ❌ auth.uid() function test failed:', error.message);
    }

    // Summary
    const enabledCount = rlsStatus.rows.filter(r => r.rls_status.includes('Enabled')).length;
    const totalTables = rlsStatus.rows.length;

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Summary:');
    console.log(`   Tables with RLS: ${enabledCount}/${totalTables}`);
    console.log(`   Total policies: ${totalPolicies}`);
    console.log(`   Helper functions: ${functions.rows.length}/3`);

    if (enabledCount === totalTables && totalPolicies > 0 && functions.rows.length === 3) {
      console.log('\n✅ Row Level Security is properly configured!');
    } else {
      console.log('\n⚠️  Some RLS components are missing. Run: node scripts/apply-rls.js');
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('❌ Error verifying RLS:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

verifyRLS();
