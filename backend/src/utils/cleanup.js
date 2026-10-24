const File = require('../models/File');
const Acl = require('../models/Acl');
const driver = require('../storage');

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function cleanupOnce() {
  const stale = await File.find({
    status: 'uploading',
    createdAt: { $lt: new Date(Date.now() - MAX_AGE_MS) },
  }).select('_id');

  for (const f of stale) {
    try {
      await driver.deleteAll(f._id.toString());
      await Acl.deleteMany({ fileId: f._id });
      await File.deleteOne({ _id: f._id });
    } catch (e) {
      console.error('cleanup failed for', f._id.toString(), e.message);
    }
  }
  if (stale.length) console.log(`cleanup: removed ${stale.length} abandoned upload(s)`);
}

function startCleanup() {
  cleanupOnce().catch((e) => console.error('cleanup error:', e.message));
  setInterval(
    () => cleanupOnce().catch((e) => console.error('cleanup error:', e.message)),
    60 * 60 * 1000
  ).unref();
}

module.exports = { startCleanup, cleanupOnce };