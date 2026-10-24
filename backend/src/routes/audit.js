const express = require('express');
const AuditEvent = require('../models/AuditEvent');
const auth = require('../middleware/auth');
const requireAccess = require('../middleware/acl');
const { logEvent } = require('../utils/audit');

const router = express.Router();
router.use(auth);

// GET /audit/:fileId?limit=50&before=<ISO date>
router.get('/:id', requireAccess(['owner']), async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const query = { fileId: req.fileDoc._id };

    if (req.query.before) {
      const d = new Date(String(req.query.before));
      if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid before date' });
      query.createdAt = { $lt: d };
    }

    const events = await AuditEvent.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('userId', 'email')
      .lean();

    await logEvent(req, 'audit_view', req.fileDoc._id);

    res.json(
      events.map((e) => ({
        id: e._id,
        action: e.action,
        user: e.userId ? e.userId.email : null,
        ip: e.ip,
        userAgent: e.userAgent,
        meta: e.meta,
        at: e.createdAt,
      }))
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load audit log' });
  }
});

module.exports = router;