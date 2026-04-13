// Test database connection and check if tables exist
require('dotenv').config();
const supabase = require('./src/config/supabase');

async function testDatabase() {
  console.log('🔍 Testing Supabase connection...\n');
  
  if (!supabase) {
    console.error('❌ Supabase client not initialized!');
    console.error('Check your .env file configuration.');
    return;
  }
  
  console.log('✅ Supabase client initialized');
  console.log(`   URL: ${process.env.SUPABASE_URL}\n`);
  
  // Test 1: Check if users table exists
  console.log('📋 Checking users table...');
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true });
  
  if (usersError) {
    console.error('❌ users table error:', usersError.message);
    console.error('   You may need to create the table in Supabase SQL Editor.');
  } else {
    console.log('✅ users table exists');
  }
  
  // Test 2: Check if focus_sessions table exists
  console.log('\n📋 Checking focus_sessions table...');
  const { data: sessions, error: sessionsError } = await supabase
    .from('focus_sessions')
    .select('id', { count: 'exact', head: true });
  
  if (sessionsError) {
    console.error('❌ focus_sessions table error:', sessionsError.message);
    console.error('   You may need to create the table in Supabase SQL Editor.');
  } else {
    console.log('✅ focus_sessions table exists');
  }
  
  // Test 3: Try to insert a test record
  console.log('\n🧪 Testing data insertion...');
  const testUserId = 'test-' + Date.now();
  
  // First create a test user
  const { error: insertUserError } = await supabase
    .from('users')
    .insert({
      id: testUserId,
      username: 'TestUser',
      email: `test-${Date.now()}@flowcube.local`,
      password_hash: 'test_hash'
    });
  
  if (insertUserError) {
    console.error('❌ Failed to insert test user:', insertUserError.message);
  } else {
    console.log('✅ Successfully inserted test user');
    
    // Clean up test user
    await supabase.from('users').delete().eq('id', testUserId);
    console.log('🗑️  Test user cleaned up');
  }
  
  console.log('\n' + '='.repeat(50));
  if (!usersError && !sessionsError) {
    console.log('🎉 Database is ready to use!');
  } else {
    console.log('⚠️  Database setup incomplete.');
    console.log('\n📝 To create tables, run this SQL in Supabase SQL Editor:');
    console.log('   https://cmflpwqxlflxojwyexab.supabase.co/project/sqleditor\n');
  }
}

testDatabase();
