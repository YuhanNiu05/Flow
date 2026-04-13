const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

const router = express.Router();

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
const TOKEN_EXPIRY = '7d';

// Simple in-memory rate limiter for auth endpoints (per IP, no external dep required)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 20; // max requests per window

function authRateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const entry = rateLimitMap.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  entry.count++;
  rateLimitMap.set(key, entry);
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests, please try again later' });
  }
  next();
}

router.use(authRateLimit);

function signToken(userId, username) {
  return jwt.sign(
    { sub: userId, username },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  if (!supabase) {
    // Demo mode: return a fake token so the frontend can still be tested
    const fakeId = 'demo-' + Date.now();
    return res.status(201).json({
      user: { id: fakeId, username, email },
      token: signToken(fakeId, username),
      demo: true
    });
  }

  // Check if email already in use
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const { data: user, error } = await supabase
    .from('users')
    .insert({ username, email, password_hash: passwordHash })
    .select('id, username, email, created_at')
    .single();

  if (error) {
    console.error('[register]', error);
    return res.status(500).json({ error: 'Failed to create account' });
  }

  const token = signToken(user.id, user.username);
  return res.status(201).json({ user: { id: user.id, username: user.username, email: user.email }, token });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  if (!supabase) {
    // Demo mode: accept any credentials
    const fakeId = 'demo-' + Date.now();
    const username = email.split('@')[0];
    return res.json({
      user: { id: fakeId, username, email },
      token: signToken(fakeId, username),
      demo: true
    });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, username, email, password_hash')
    .eq('email', email)
    .maybeSingle();

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signToken(user.id, user.username);
  return res.json({ user: { id: user.id, username: user.username, email: user.email }, token });
});

module.exports = router;
