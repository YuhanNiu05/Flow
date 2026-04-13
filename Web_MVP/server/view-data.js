// View all data in the database
require('dotenv').config();
const supabase = require('./src/config/supabase');

async function viewData() {
  console.log('📊 FlowCube Database Data Viewer\n');
  console.log('='.repeat(60));
  
  if (!supabase) {
    console.error('❌ Supabase client not initialized!');
    return;
  }
  
  // View users
  console.log('\n👥 USERS TABLE:');
  console.log('-'.repeat(60));
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (usersError) {
    console.error('Error:', usersError.message);
  } else {
    console.log(`Total users: ${users.length}`);
    users.forEach((user, i) => {
      console.log(`  ${i + 1}. ${user.username} (${user.email}) - Created: ${user.created_at}`);
    });
  }
  
  // View sessions
  console.log('\n📚 FOCUS SESSIONS TABLE:');
  console.log('-'.repeat(60));
  const { data: sessions, error: sessionsError } = await supabase
    .from('focus_sessions')
    .select('*')
    .order('completed_at', { ascending: false })
    .limit(20);
  
  if (sessionsError) {
    console.error('Error:', sessionsError.message);
  } else {
    console.log(`Total sessions: ${sessions.length}`);
    sessions.forEach((session, i) => {
      const durationMin = session.actual_duration ? Math.round(session.actual_duration / 60) : 0;
      const modeEmoji = session.mode === 'study' ? '📖' : '🏃';
      const statusEmoji = session.status === 'completed' ? '✅' : session.status === 'active' ? '⏳' : '❌';
      
      console.log(`  ${i + 1}. ${modeEmoji} ${session.mode} - ${durationMin}分钟 ${statusEmoji}`);
      console.log(`     Started: ${session.started_at} | Completed: ${session.completed_at}`);
    });
  }
  
  // Calculate total stats
  console.log('\n📈 TOTAL STATISTICS:');
  console.log('-'.repeat(60));
  const { data: allSessions } = await supabase
    .from('focus_sessions')
    .select('mode, actual_duration')
    .eq('status', 'completed');
  
  if (allSessions && allSessions.length > 0) {
    const totalDuration = allSessions.reduce((sum, s) => sum + (s.actual_duration || 0), 0);
    const studyDuration = allSessions.filter(s => s.mode === 'study').reduce((sum, s) => sum + (s.actual_duration || 0), 0);
    const exerciseDuration = allSessions.filter(s => s.mode === 'exercise').reduce((sum, s) => sum + (s.actual_duration || 0), 0);
    
    console.log(`  Total sessions: ${allSessions.length}`);
    console.log(`  Total duration: ${Math.round(totalDuration / 60)} 分钟 (${(totalDuration / 3600).toFixed(2)} 小时)`);
    console.log(`  Study duration: ${Math.round(studyDuration / 60)} 分钟 (${(studyDuration / 3600).toFixed(2)} 小时)`);
    console.log(`  Exercise duration: ${Math.round(exerciseDuration / 60)} 分钟 (${(exerciseDuration / 3600).toFixed(2)} 小时)`);
  } else {
    console.log('  No completed sessions yet.');
  }
  
  console.log('\n' + '='.repeat(60));
}

viewData();
