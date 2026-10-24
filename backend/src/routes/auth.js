const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

const BCRYPT_COST = 12;

const DUMMY_HASH = bcrypt.hashSync('dummy-value', BCRYPT_COST);

const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 30 });

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

// Deterministic fake salt for unknown emails, so attackers can't tell
function fakeSalt(email) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET).update(email).digest('base64');
}

function userPayload(user) {
  return {
    id: user._id,
    email: user.email,
    publicKey: user.publicKey,
    wrappedPrivateKey: user.wrappedPrivateKey,
    privateKeyIv: user.privateKeyIv,
    kdfSalt: user.kdfSalt,
    kdfIterations: user.kdfIterations,
  };
}

// POST /auth/register
router.post('/register', authLimiter, async (req, res) => {
  try {
    const {
      email, authKey, publicKey, wrappedPrivateKey,
      privateKeyIv, kdfSalt, kdfIterations,
    } = req.body;

    if (![email, authKey, publicKey, wrappedPrivateKey, privateKeyIv, kdfSalt].every(
      (v) => typeof v === 'string' && v.length > 0
    )) {
      return res.status(400).json({ error: 'Missing or invalid fields' });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists) return res.status(409).json({ error: 'Email already registered' });

    const user = await User.create({
      email,
      authHash: await bcrypt.hash(authKey, BCRYPT_COST),
      publicKey,
      wrappedPrivateKey,
      privateKeyIv,
      kdfSalt,
      kdfIterations: Number(kdfIterations) || 600000,
    });

    res.status(201).json({ token: signToken(user), user: userPayload(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// GET /auth/salt/:email 
router.get('/salt/:email', authLimiter, async (req, res) => {
  const email = String(req.params.email).toLowerCase();
  const user = await User.findOne({ email }).select('kdfSalt kdfIterations');
  if (!user) {
    return res.json({ kdfSalt: fakeSalt(email), kdfIterations: 600000 });
  }
  res.json({ kdfSalt: user.kdfSalt, kdfIterations: user.kdfIterations });
});

// POST /auth/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, authKey } = req.body;
    if (typeof email !== 'string' || typeof authKey !== 'string') {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    const ok = await bcrypt.compare(authKey, user ? user.authHash : DUMMY_HASH);

    if (!user || !ok) return res.status(401).json({ error: 'Invalid credentials' });

    res.json({ token: signToken(user), user: userPayload(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /auth/me
router.get('/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(userPayload(user));
});

// GET /auth/users/:email/publickey 
router.get('/users/:email/publickey', auth, async (req, res) => {
  const user = await User.findOne({ email: String(req.params.email).toLowerCase() })
    .select('_id email publicKey');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user._id, email: user.email, publicKey: user.publicKey });
});

module.exports = router;