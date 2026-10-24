// Pick the storage driver from STORAGE=local | s3 (default: local)
const type = (process.env.STORAGE || 'local').toLowerCase();

if (type === 's3') {
  const S3Driver = require('./S3Driver');
  module.exports = new S3Driver();
} else {
  const LocalDriver = require('./LocalDriver');
  module.exports = new LocalDriver();
}