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

  // Run queries in parallel
  const [allRes, todayRes, weekRes] = await Promise.all([
    supabase
      .from('focus_sessions')
      .select('mode, actual_duration')
      .eq('user_id', userId)
      .eq('status', 'completed'),
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

  if (allRes.error || todayRes.error || weekRes.error) {
    console.error('[stats]', allRes.error || todayRes.error || weekRes.error);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }

  const all = allRes.data;
  const totalSessions = all.length;
  const totalDuration = all.reduce((s, r) => s + (r.actual_duration || 0), 0);
  const studyDuration = all.filter(r => r.mode === 'study').reduce((s, r) => s + (r.actual_duration || 0), 0);
  const exerciseDuration = all.filter(r => r.mode === 'exercise').reduce((s, r) => s + (r.actual_duration || 0), 0);
  const todayDuration = todayRes.data.reduce((s, r) => s + (r.actual_duration || 0), 0);
  const weekDuration = weekRes.data.reduce((s, r) => s + (r.actual_duration || 0), 0);

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
