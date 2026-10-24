const mongoose = require('mongoose');
const File = require('../models/File');
const Acl = require('../models/Acl');
const { logEvent } = require('../utils/audit');

module.exports = function requireAccess(allowedRoles) {
  return async function (req, res, next) {
    try {
      const fileId = req.params.id;

      
      const deny = async () => {
        await logEvent(req, 'denied', mongoose.isValidObjectId(fileId) ? fileId : undefined, {
          path: req.originalUrl,
          method: req.method,
        });
        return res.status(403).json({ error: 'Access denied' });
      };

      if (!mongoose.isValidObjectId(fileId)) return deny();

      const [file, acl] = await Promise.all([
        File.findById(fileId),
        Acl.findOne({ fileId, userId: req.user.id, revokedAt: null }),
      ]);

      if (!file || file.status === 'deleted' || !acl) return deny();
      if (!allowedRoles.includes(acl.role)) return deny();

      if (acl.requireMfa && !req.mfaVerified) {
        await logEvent(req, 'mfa_required', file._id, { path: req.originalUrl });
        return res.status(401).json({ error: 'MFA required for this file', mfaRequired: true });
      }

      req.fileDoc = file;
      req.acl = acl;
      next();
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Access check failed' });
    }
  };
};