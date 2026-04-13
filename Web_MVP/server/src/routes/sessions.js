const express = require('express');
const supabase = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// All session routes require authentication
router.use(authMiddleware);

// POST /api/sessions — create / start a focus session
router.post('/', async (req, res) => {
  const userId = req.user.sub;
  const { mode, timer_type, planned_duration } = req.body;

  if (!mode || !['study', 'exercise'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be "study" or "exercise"' });
  }
  if (!timer_type || !['forward', 'countdown'].includes(timer_type)) {
    return res.status(400).json({ error: 'timer_type must be "forward" or "countdown"' });
  }

  if (!supabase) {
    // Demo mode
    return res.status(201).json({
      session: { id: 'demo-session-' + Date.now(), user_id: userId, mode, timer_type, planned_duration, started_at: new Date().toISOString(), status: 'active' },
      demo: true
    });
  }

  const { data: session, error } = await supabase
    .from('focus_sessions')
    .insert({
      user_id: userId,
      mode,
      timer_type,
      planned_duration: planned_duration || null,
      started_at: new Date().toISOString(),
      status: 'active'
    })
    .select()
    .single();

  if (error) {
    console.error('[sessions/create]', error);
    return res.status(500).json({ error: 'Failed to create session' });
  }

  return res.status(201).json({ session });
});

// PUT /api/sessions/:id/complete — end a session
router.put('/:id/complete', async (req, res) => {
  const userId = req.user.sub;
  const sessionId = req.params.id;
  const { actual_duration } = req.body;

  if (actual_duration === undefined || actual_duration < 0) {
    return res.status(400).json({ error: 'actual_duration (seconds) is required' });
  }

  if (!supabase) {
    return res.json({
      session: { id: sessionId, status: 'completed', actual_duration, completed_at: new Date().toISOString() },
      demo: true
    });
  }

  const { data: session, error } = await supabase
    .from('focus_sessions')
    .update({
      status: 'completed',
      actual_duration,
      completed_at: new Date().toISOString()
    })
    .eq('id', sessionId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error || !session) {
    console.error('[sessions/complete]', error);
    return res.status(404).json({ error: 'Session not found or unauthorized' });
  }

  return res.json({ session });
});

// DELETE /api/sessions/:id — abandon a session
router.delete('/:id', async (req, res) => {
  const userId = req.user.sub;
  const sessionId = req.params.id;

  if (!supabase) {
    return res.json({ success: true, demo: true });
  }

  const { error } = await supabase
    .from('focus_sessions')
    .update({ status: 'abandoned', completed_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('user_id', userId);

  if (error) {
    console.error('[sessions/abandon]', error);
    return res.status(500).json({ error: 'Failed to abandon session' });
  }

  return res.json({ success: true });
});

// GET /api/sessions — list completed sessions for the current user
router.get('/', async (req, res) => {
  const userId = req.user.sub;
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);

  if (!supabase) {
    return res.json({ sessions: [], total: 0, demo: true });
  }

  const { data: sessions, error, count } = await supabase
    .from('focus_sessions')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('[sessions/list]', error);
    return res.status(500).json({ error: 'Failed to fetch sessions' });
  }

  return res.json({ sessions, total: count });
});

module.exports = router;
