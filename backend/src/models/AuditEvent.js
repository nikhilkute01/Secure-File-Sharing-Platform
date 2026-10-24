const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema(
  {
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File', index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: {
      type: String,
         enum: [
        'upload_init', 'upload_complete', 'download', 'share',
        'revoke', 'denied', 'audit_view', 'delete', 'rotate',
        'mfa_required', 'mfa_verified', 'mfa_failed', 'mfa_enabled', 'mfa_disabled', 'search',
      ],
      required: true,
    },
    ip: String,
    userAgent: String,
    meta: { type: Object },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditSchema.index({ fileId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditEvent', auditSchema);