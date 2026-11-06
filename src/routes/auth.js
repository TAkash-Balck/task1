const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { username, email, password } = req.body || {};
  const errors = [];

  if (!isNonEmptyString(username) || username.trim().length < 3 || username.trim().length > 30) {
    errors.push('username must be a string of 3-30 characters');
  }
  if (!isNonEmptyString(email) || !EMAIL_RE.test(email.trim())) {
    errors.push('email must be a valid email address');
  }
  if (typeof password !== 'string' || password.length < 8) {
    errors.push('password must be a string of at least 8 characters');
  }
  if (errors.length) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const cleanUsername = username.trim();
  const cleanEmail = email.trim().toLowerCase();

  const existing = db
    .prepare('SELECT id FROM users WHERE username = ? OR email = ?')
    .get(cleanUsername, cleanEmail);
  if (existing) {
    return res.status(409).json({ error: 'Username or email already in use' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const result = db
    .prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
    .run(cleanUsername, cleanEmail, passwordHash);

  res.status(201).json({
    message: 'User registered successfully',
    user: { id: result.lastInsertRowid, username: cleanUsername, email: cleanEmail },
  });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};

  if (!isNonEmptyString(email) || typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ error: 'Validation failed', details: ['email and password are required'] });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  // Same response for unknown email and wrong password to avoid user enumeration.
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  res.status(200).json({
    message: 'Login successful',
    token: signToken(user),
    user: { id: user.id, username: user.username, email: user.email },
  });
});

module.exports = router;
