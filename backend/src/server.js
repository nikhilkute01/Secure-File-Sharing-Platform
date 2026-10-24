require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');
const { startCleanup } = require('./utils/cleanup');

const app = express();

app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60_000, max: 600 }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/auth', require('./routes/auth'));
app.use('/files', require('./routes/files'));
app.use('/share', require('./routes/share'));
app.use('/audit', require('./routes/audit'));
app.use('/mfa', require('./routes/mfa'));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return res.destroy();
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' });
});

connectDB()
  .then(() => {
    startCleanup();
    app.listen(process.env.PORT, () =>
      console.log(`API on http://localhost:${process.env.PORT} (storage: ${process.env.STORAGE || 'local'})`)
    );
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });