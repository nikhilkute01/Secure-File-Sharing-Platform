const mongoose = require('mongoose');

const aclSchema = new mongoose.Schema(
  {
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'viewer'], required: true },

    wrappedFileKey: { type: String, required: true },
    wrapIv: { type: String, required: true },
    senderPublicKey: { type: String, required: true },

    keyVersion: { type: Number, default: 1 },
    grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    revokedAt: { type: Date, default: null },

    requireMfa: { type: Boolean, default: false },
  },
  { timestamps: true }
);


aclSchema.index({ userId: 1, fileId: 1 }, { unique: true });
aclSchema.index({ fileId: 1 });

module.exports = mongoose.model('Acl', aclSchema);