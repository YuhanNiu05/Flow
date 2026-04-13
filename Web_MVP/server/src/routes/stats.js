const express = require('express');
const supabase = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

// GET /api/stats — return aggregated focus statistics for the current user
router.get('/', async (req, res) => {
  const userId = req.user.sub;

  if (!supabase) {
    // Return demo stats
    return res.json({
      total_sessions: 0,
      total_duration: 0,
      study_duration: 0,
      exercise_duration: 0,
      today_duration: 0,
      week_duration: 0,
      demo: true
    });
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Get user's cumulative stats from users table (fast)
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('total_study_duration, total_exercise_duration, total_sessions')
    .eq('id', userId)
    .single();

  // Get today and week stats from sessions (still need to calculate)
  const [todayRes, weekRes] = await Promise.all([
    supabase
      .from('focus_sessions')
      .select('actual_duration')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .gte('completed_at', todayStart),
    supabase
      .from('focus_sessions')
      .select('actual_duration')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .gte('completed_at', weekStart)
  ]);

  if (userError && userError.code !== 'PGRST116') {
    console.error('[stats]', userError);
  }

  if (todayRes.error || weekRes.error) {
    console.error('[stats]', todayRes.error || weekRes.error);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }

  const todayDuration = todayRes.data.reduce((s, r) => s + (r.actual_duration || 0), 0);
  const weekDuration = weekRes.data.reduce((s, r) => s + (r.actual_duration || 0), 0);
  
  // Use cumulative stats if available, otherwise calculate from sessions
  const studyDuration = userData?.total_study_duration || 0;
  const exerciseDuration = userData?.total_exercise_duration || 0;
  const totalSessions = userData?.total_sessions || 0;
  const totalDuration = studyDuration + exerciseDuration;

  return res.json({
    total_sessions: totalSessions,
    total_duration: totalDuration,
    study_duration: studyDuration,
    exercise_duration: exerciseDuration,
    today_duration: todayDuration,
    week_duration: weekDuration
  });
});

module.exports = router;
