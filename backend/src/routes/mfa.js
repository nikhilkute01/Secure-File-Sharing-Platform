const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { authenticator } = require('otplib');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { logEvent } = require('../utils/audit');

const router = express.Router();
router.use(auth);

authenticator.options = { window: 1 }; 

const mfaLimiter = rateLimit({
  windowMs: 5 * 60_000,
  max: 10,
  keyGenerator: (req) => `mfa:${req.user.id}`,
  validate: { keyGeneratorIpFallback: false },
  message: { error: 'Too many MFA attempts. Try again in a few minutes.' },
});


const encKey = () => crypto.createHash('sha256').update(`mfa-v1:${process.env.JWT_SECRET}`).digest();
function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}
function decryptSecret(blob) {
  const [iv, tag, ct] = blob.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

const validCode = (c) => typeof c === 'string' && /^\d{6}$/.test(c.trim());

router.get('/status', async (req, res) => {
  const u = await User.findById(req.user.id).select('mfaEnabled');
  res.json({ enabled: !!(u && u.mfaEnabled) });
});

router.post('/setup', mfaLimiter, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.mfaEnabled) return res.status(409).json({ error: 'MFA already enabled' });

  const secret = authenticator.generateSecret();
  user.mfaSecretEnc = encryptSecret(secret);
  await user.save();
  res.json({ secret, otpauth: authenticator.keyuri(user.email, 'SecureVault', secret) });
});

router.post('/enable', mfaLimiter, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.mfaSecretEnc) return res.status(400).json({ error: 'Run setup first' });
  if (!validCode(req.body.code)) return res.status(400).json({ error: 'Enter the 6-digit code' });

  if (!authenticator.check(req.body.code.trim(), decryptSecret(user.mfaSecretEnc))) {
    await logEvent(req, 'mfa_failed', undefined, { step: 'enable' });
    return res.status(401).json({ error: 'Wrong code' });
  }
  user.mfaEnabled = true;
  await user.save();
  await logEvent(req, 'mfa_enabled');
  res.json({ ok: true });
});

router.post('/disable', mfaLimiter, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.mfaEnabled) return res.status(400).json({ error: 'MFA is not enabled' });
  if (!validCode(req.body.code) || !authenticator.check(req.body.code.trim(), decryptSecret(user.mfaSecretEnc))) {
    await logEvent(req, 'mfa_failed', undefined, { step: 'disable' });
    return res.status(401).json({ error: 'Wrong code' });
  }
  user.mfaEnabled = false;
  user.mfaSecretEnc = null;
  await user.save();
  await logEvent(req, 'mfa_disabled');
  res.json({ ok: true });
});

router.post('/verify', mfaLimiter, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.mfaEnabled) {
    return res.status(400).json({ error: 'Enable MFA in Security settings first' });
  }
  if (!validCode(req.body.code) || !authenticator.check(req.body.code.trim(), decryptSecret(user.mfaSecretEnc))) {
    await logEvent(req, 'mfa_failed', undefined, { step: 'verify' });
    return res.status(401).json({ error: 'Wrong code' });
  }
  const mfaToken = jwt.sign({ sub: req.user.id, mfa: true }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '10m',
  });
  await logEvent(req, 'mfa_verified');
  res.json({ mfaToken, expiresIn: 600 });
});

module.exports = router;