const express = require('express');
const File = require('../models/File');
const Acl = require('../models/Acl');
const auth = require('../middleware/auth');
const requireAccess = require('../middleware/acl');
const driver = require('../storage');
const { logEvent } = require('../utils/audit');

const router = express.Router();
router.use(auth); 

const MB = 1024 * 1024;
const MAX_FILE_SIZE = 2 * 1024 * MB; 
const MIN_CHUNK = 5 * MB;            
const MAX_CHUNK = 16 * MB;
const PART_OVERHEAD = 28;

const MAX_TOKENS = 64;
const isStr = (v, max = 4096) => typeof v === 'string' && v.length > 0 && v.length <= max;

// POST /files/init
router.post('/init', async (req, res) => {
  try {
    const {
      encryptedName, nameIv, size, chunkSize, totalChunks,
      wrappedFileKey, wrapIv, senderPublicKey, searchTokens,
    } = req.body;

    if (![encryptedName, nameIv, wrappedFileKey, wrapIv, senderPublicKey].every((v) => isStr(v))) {
      return res.status(400).json({ error: 'Missing or invalid fields' });
    }
    if (!Number.isInteger(size) || size < 1 || size > MAX_FILE_SIZE) {
      return res.status(400).json({ error: 'Invalid file size (max 2 GB)' });
    }
    if (!Number.isInteger(chunkSize) || chunkSize < MIN_CHUNK || chunkSize > MAX_CHUNK) {
      return res.status(400).json({ error: 'Chunk size must be 5-16 MB' });
    }
    if (totalChunks !== Math.ceil(size / chunkSize)) {
      return res.status(400).json({ error: 'totalChunks does not match size' });
    }

    const tokens = Array.isArray(searchTokens) ? searchTokens : [];
    if (tokens.length > MAX_TOKENS || !tokens.every((t) => isStr(t, 64))) {
      return res.status(400).json({ error: 'Invalid search tokens' });
    }

    const file = await File.create({
      ownerId: req.user.id,
      encryptedName, nameIv, size, chunkSize, totalChunks,
      searchTokens: [...new Set(tokens)],
    });

    try {
      await Acl.create({
        fileId: file._id,
        userId: req.user.id,
        role: 'owner',
        wrappedFileKey, wrapIv, senderPublicKey,
        grantedBy: req.user.id,
      });
      await driver.initUpload(file._id.toString());
    } catch (e) {
      await File.deleteOne({ _id: file._id }); // no orphan records
      await Acl.deleteMany({ fileId: file._id });
      throw e;
    }

    await logEvent(req, 'upload_init', file._id, { size, totalChunks });
    res.status(201).json({ fileId: file._id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not start upload' });
  }
});

// POST /files/search  -> encrypted search (bonus). Body: { tokens: [blind tokens] }
// The server matches opaque HMAC tokens; it never sees the search words or filenames.
router.post('/search', async (req, res) => {
  const { tokens } = req.body;
  if (!Array.isArray(tokens) || tokens.length < 1 || tokens.length > 8 || !tokens.every((t) => isStr(t, 64))) {
    return res.status(400).json({ error: 'Invalid tokens' });
  }
  const hits = await File.find({
    ownerId: req.user.id,
    status: 'ready',
    searchTokens: { $all: tokens },
  }).select('_id');
  await logEvent(req, 'search', undefined, { tokens: tokens.length, hits: hits.length });
  res.json({ ids: hits.map((h) => h._id) });
});

// GET /files  -> every file I can currently access
router.get('/', async (req, res) => {
  const entries = await Acl.find({ userId: req.user.id, revokedAt: null }).populate('fileId');
  const out = entries
    .filter((e) => e.fileId && e.fileId.status === 'ready')
    .map((e) => ({
      fileId: e.fileId._id,
      role: e.role,
      size: e.fileId.size,
      totalChunks: e.fileId.totalChunks,
      encryptedName: e.fileId.encryptedName,
      nameIv: e.fileId.nameIv,
      wrappedFileKey: e.wrappedFileKey,
      wrapIv: e.wrapIv,
      senderPublicKey: e.senderPublicKey,
      requireMfa: e.requireMfa,
      createdAt: e.fileId.createdAt,
    }));
  res.json(out);
});

// GET /files/:id/status  -> which parts are already uploaded (for resume)
router.get('/:id/status', requireAccess(['owner']), async (req, res) => {
  const onDisk = await driver.listParts(req.params.id);
  res.json({ status: req.fileDoc.status, totalChunks: req.fileDoc.totalChunks, uploaded: onDisk });
});

// PUT /files/:id/parts/:n  -> upload one encrypted chunk (raw bytes)
router.put('/:id/parts/:n', requireAccess(['owner']), async (req, res) => {
  const file = req.fileDoc;
  const n = Number(req.params.n);

  if (file.status !== 'uploading') return res.status(409).json({ error: 'Upload already finished' });
  if (!Number.isInteger(n) || n < 0 || n >= file.totalChunks) {
    return res.status(400).json({ error: 'Invalid part number' });
  }

  const len = Number(req.headers['content-length']);
  const max = file.chunkSize + PART_OVERHEAD;
  if (!len || len < PART_OVERHEAD) return res.status(400).json({ error: 'Content-Length required' });
  if (len > max) return res.status(413).json({ error: 'Part too large' });

  try {
    await driver.putPart(req.params.id, n, req, max);
    await File.updateOne({ _id: file._id }, { $addToSet: { uploadedChunks: n } });
    res.json({ ok: true, part: n });
  } catch (e) {
    if (res.headersSent) return;
    if (e.message === 'PART_TOO_LARGE') return res.status(413).json({ error: 'Part too large' });
    console.error(e);
    res.status(500).json({ error: 'Part upload failed' });
  }
});

// POST /files/:id/complete  -> verify all parts exist, mark ready
router.post('/:id/complete', requireAccess(['owner']), async (req, res) => {
  const file = req.fileDoc;
  if (file.status === 'ready') return res.json({ ok: true });

  const onDisk = new Set(await driver.listParts(req.params.id));
  const missing = [];
  for (let i = 0; i < file.totalChunks; i++) if (!onDisk.has(i)) missing.push(i);

  if (missing.length) return res.status(400).json({ error: 'Missing parts', missing });

  file.status = 'ready';
  await file.save();
  await logEvent(req, 'upload_complete', file._id);
  res.json({ ok: true });
});

// GET /files/:id/meta  -> file info + MY wrapped key (owner or viewer)
router.get('/:id/meta', requireAccess(['owner', 'viewer']), (req, res) => {
  const f = req.fileDoc;
  const a = req.acl;
  if (f.status !== 'ready') return res.status(409).json({ error: 'File not ready' });
  res.json({
    fileId: f._id,
    role: a.role,
    size: f.size,
    chunkSize: f.chunkSize,
    totalChunks: f.totalChunks,
    encryptedName: f.encryptedName,
    nameIv: f.nameIv,
    wrappedFileKey: a.wrappedFileKey,
    wrapIv: a.wrapIv,
    senderPublicKey: a.senderPublicKey,
    keyVersion: f.keyVersion,
  });
});

// GET /files/:id/parts/:n  -> download one encrypted chunk
router.get('/:id/parts/:n', requireAccess(['owner', 'viewer']), async (req, res) => {
  const file = req.fileDoc;
  const n = Number(req.params.n);

  if (file.status !== 'ready') return res.status(409).json({ error: 'File not ready' });
  if (!Number.isInteger(n) || n < 0 || n >= file.totalChunks) {
    return res.status(400).json({ error: 'Invalid part number' });
  }

  
  if (n === 0) await logEvent(req, 'download', file._id);

  res.set({
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'no-store',
  });

  const stream = driver.getPart(req.params.id, n);
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).json({ error: 'Part not found' });
    else res.destroy();
  });
  stream.pipe(res);
});

// DELETE /files/:id  -> owner deletes; revoke everyone (cascade)
router.delete('/:id', requireAccess(['owner']), async (req, res) => {
  const file = req.fileDoc;
  file.status = 'deleted';
  await file.save();
  await Acl.updateMany({ fileId: file._id, revokedAt: null }, { revokedAt: new Date() });
  await driver.deleteAll(req.params.id);
  await logEvent(req, 'delete', file._id);
  res.json({ ok: true });
});

module.exports = router;