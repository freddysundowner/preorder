import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate } from './migrate.js';
import { UPLOAD_DIR } from './uploads.js';
import { loadSettings } from './services/settings.js';
import { startJobs } from './jobs.js';
import authRoutes from './routes/auth.js';
import shopRoutes from './routes/shop.js';
import adminRoutes from './routes/admin.js';
import webhookRoutes from './routes/webhooks.js';

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: config.webOrigin.split(','), credentials: false }));
app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: false }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use('/api/auth', authRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', shopRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// In production, serve the built React app from ../web/dist if it exists
const webDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.expose ? 'Something went wrong. Please try again.' : err.message });
});

await migrate();
await loadSettings();
startJobs();
app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));
