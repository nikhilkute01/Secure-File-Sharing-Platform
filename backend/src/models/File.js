const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    encryptedName: { type: String, required: true },
    nameIv: { type: String, required: true },

    size: { type: Number, required: true },        
    chunkSize: { type: Number, required: true },   
    totalChunks: { type: Number, required: true },
    uploadedChunks: { type: [Number], default: [] },

    searchTokens: { type: [String], default: [] },

    status: { type: String, enum: ['uploading', 'ready', 'deleted'], default: 'uploading' },

    
    keyVersion: { type: Number, default: 1 },
    
    pendingRotation: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

fileSchema.index({ ownerId: 1, searchTokens: 1 });

module.exports = mongoose.model('File', fileSchema);