const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Acl = require('../models/Acl');
const File = require('../models/File');
const auth = require('../middleware/auth');
const requireAccess = require('../middleware/acl');
const driver = require('../storage');
const { logEvent } = require('../utils/audit');

const router = express.Router();
router.use(auth);

const isStr = (v, max = 4096) => typeof v === 'string' && v.length > 0 && v.length <= max;
const PART_OVERHEAD = 28; // IV (12) + GCM tag (16)

// POST /share/:id 
router.post('/:id', requireAccess(['owner']), async (req, res) => {
  try {
    const { recipientEmail, wrappedFileKey, wrapIv, senderPublicKey } = req.body;
    const requireMfa = req.body.requireMfa === true;

    if (![recipientEmail, wrappedFileKey, wrapIv, senderPublicKey].every((v) => isStr(v))) {
      return res.status(400).json({ error: 'Missing or invalid fields' });
    }
    if (req.fileDoc.status !== 'ready') {
      return res.status(409).json({ error: 'File not ready' });
    }

    const recipient = await User.findOne({ email: recipientEmail.toLowerCase() });
    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });
    if (recipient._id.toString() === req.user.id) {
      return res.status(400).json({ error: 'You already own this file' });
    }

    if (requireMfa && !recipient.mfaEnabled) {
      return res.status(400).json({ error: 'Recipient has not enabled MFA, so this file cannot be restricted to MFA' });
    }

    // Upsert: re-sharing after a revoke reactivates the entry with a fresh wrapped key.
    await Acl.findOneAndUpdate(
      { fileId: req.fileDoc._id, userId: recipient._id },
      {
        $set: {
          role: 'viewer',
          wrappedFileKey,
          wrapIv,
          senderPublicKey,
          keyVersion: req.fileDoc.keyVersion,
          grantedBy: req.user.id,
          revokedAt: null,
          requireMfa,
        },
      },
      { upsert: true, new: true }
    );

    await logEvent(req, 'share', req.fileDoc._id, { to: recipient.email, requireMfa });
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Share failed' });
  }
});

// GET /share/:id/list  
router.get('/:id/list', requireAccess(['owner']), async (req, res) => {
  const entries = await Acl.find({ fileId: req.fileDoc._id, revokedAt: null })
    .populate('userId', 'email');
  res.json(
    entries.map((e) => ({
      userId: e.userId._id,
      email: e.userId.email,
      role: e.role,
      keyVersion: e.keyVersion,
      requireMfa: e.requireMfa,
      since: e.createdAt,
    }))
  );
});

// DELETE /share/:id/:userId  
router.delete('/:id/:userId', requireAccess(['owner']), async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) return res.status(400).json({ error: 'Bad user id' });
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Owner cannot revoke themselves' });
    }

    const result = await Acl.updateOne(
      { fileId: req.fileDoc._id, userId, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: 'No active share found' });

    await logEvent(req, 'revoke', req.fileDoc._id, { userId });
    res.json({
      ok: true,
      note: 'Access revoked. Rotate the file key to also invalidate any key they already saved.',
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Revoke failed' });
  }
});

//KEY ROTATION
router.post('/:id/rotate/init', requireAccess(['owner']), async (req, res) => {
  try {
    const file = req.fileDoc;
    if (file.status !== 'ready') return res.status(409).json({ error: 'File not ready' });

    const { encryptedName, nameIv, wraps } = req.body;
    if (!isStr(encryptedName) || !isStr(nameIv) || !Array.isArray(wraps) || wraps.length === 0) {
      return res.status(400).json({ error: 'Missing or invalid fields' });
    }

    // The client must supply a wrap for exactly the users who currently have access.
    const active = await Acl.find({ fileId: file._id, revokedAt: null });
    const activeIds = new Set(active.map((a) => a.userId.toString()));
    const wrapIds = new Set(wraps.map((w) => String(w.userId)));
    if (
      wraps.length !== activeIds.size ||
      wrapIds.size !== activeIds.size ||
      [...activeIds].some((id) => !wrapIds.has(id))
    ) {
      return res.status(400).json({ error: 'wraps must match the current active users exactly' });
    }
    for (const w of wraps) {
      if (![w.wrappedFileKey, w.wrapIv, w.senderPublicKey].every((v) => isStr(v))) {
        return res.status(400).json({ error: 'Invalid wrap entry' });
      }
    }

    await File.updateOne(
      { _id: file._id },
      {
        $set: {
          pendingRotation: {
            encryptedName,
            nameIv,
            wraps: wraps.map((w) => ({
              userId: String(w.userId),
              wrappedFileKey: w.wrappedFileKey,
              wrapIv: w.wrapIv,
              senderPublicKey: w.senderPublicKey,
            })),
            createdAt: new Date(),
          },
        },
      }
    );
    await driver.initStage(req.params.id); 

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Rotation init failed' });
  }
});

// PUT /share/:id/rotate/parts/:n
router.put('/:id/rotate/parts/:n', requireAccess(['owner']), async (req, res) => {
  const file = req.fileDoc;
  const n = Number(req.params.n);

  if (!file.pendingRotation) return res.status(409).json({ error: 'No rotation in progress' });
  if (!Number.isInteger(n) || n < 0 || n >= file.totalChunks) {
    return res.status(400).json({ error: 'Invalid part number' });
  }

  const len = Number(req.headers['content-length']);
  const max = file.chunkSize + PART_OVERHEAD;
  if (!len || len < PART_OVERHEAD) return res.status(400).json({ error: 'Content-Length required' });
  if (len > max) return res.status(413).json({ error: 'Part too large' });

  try {
    await driver.putStagePart(req.params.id, n, req, max);
    res.json({ ok: true, part: n });
  } catch (e) {
    if (res.headersSent) return;
    if (e.message === 'PART_TOO_LARGE') return res.status(413).json({ error: 'Part too large' });
    console.error(e);
    res.status(500).json({ error: 'Part upload failed' });
  }
});

// POST /share/:id/rotate/complete  
router.post('/:id/rotate/complete', requireAccess(['owner']), async (req, res) => {
  try {
    const file = req.fileDoc;
    const pending = file.pendingRotation;
    if (!pending) return res.status(409).json({ error: 'No rotation in progress' });

    const staged = new Set(await driver.listStageParts(req.params.id));
    const missing = [];
    for (let i = 0; i < file.totalChunks; i++) if (!staged.has(i)) missing.push(i);
    if (missing.length) return res.status(400).json({ error: 'Missing parts', missing });

    // 2. The access list must not have changed since init, or someone would
    const active = await Acl.find({ fileId: file._id, revokedAt: null });
    const activeIds = new Set(active.map((a) => a.userId.toString()));
    const wrapIds = new Set(pending.wraps.map((w) => w.userId));
    const same =
      activeIds.size === wrapIds.size && [...activeIds].every((id) => wrapIds.has(id));
    if (!same) {
      await driver.abortStage(req.params.id);
      await File.updateOne({ _id: file._id }, { $set: { pendingRotation: null } });
      return res.status(409).json({ error: 'Access list changed during rotation. Please start again.' });
    }


    await driver.commitStage(req.params.id);
    const newVersion = file.keyVersion + 1;
    for (const w of pending.wraps) {
      await Acl.updateOne(
        { fileId: file._id, userId: w.userId, revokedAt: null },
        {
          $set: {
            wrappedFileKey: w.wrappedFileKey,
            wrapIv: w.wrapIv,
            senderPublicKey: w.senderPublicKey,
            keyVersion: newVersion,
          },
        }
      );
    }
    await File.updateOne(
      { _id: file._id },
      {
        $set: {
          encryptedName: pending.encryptedName,
          nameIv: pending.nameIv,
          keyVersion: newVersion,
          pendingRotation: null,
        },
      }
    );

    await logEvent(req, 'rotate', file._id, { keyVersion: newVersion });
    res.json({ ok: true, keyVersion: newVersion });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Rotation failed' });
  }
});

// POST /share/:id/rotate/abort  
router.post('/:id/rotate/abort', requireAccess(['owner']), async (req, res) => {
  await driver.abortStage(req.params.id);
  await File.updateOne({ _id: req.fileDoc._id }, { $set: { pendingRotation: null } });
  res.json({ ok: true });
});

module.exports = router;