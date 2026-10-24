const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },

    authHash: { type: String, required: true },

    publicKey: { type: String, required: true },

    wrappedPrivateKey: { type: String, required: true },
    privateKeyIv: { type: String, required: true },
    kdfSalt: { type: String, required: true },
    kdfIterations: { type: Number, default: 600000 },

    role: { type: String, enum: ['user', 'admin'], default: 'user' },

    mfaEnabled: { type: Boolean, default: false },
    mfaSecretEnc: { type: String, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);