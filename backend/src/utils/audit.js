const AuditEvent = require('../models/AuditEvent');

// Never let a logging failure break the request.
async function logEvent(req, action, fileId, meta) {
  try {
    await AuditEvent.create({
      fileId,
      userId: req.user ? req.user.id : undefined,
      action,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      meta,
    });
  } catch (e) {
    console.error('audit log failed:', e.message);
  }
}

module.exports = { logEvent };