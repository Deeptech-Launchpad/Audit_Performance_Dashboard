import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './lib/http.js';
import { authRouter, attachUser } from './routes/auth.js';
import { dataRouter } from './routes/data.js';
import { uploadsRouter } from './routes/uploads.js';
import { reportsRouter } from './routes/reports.js';
import { adminRouter } from './routes/admin.js';
import { feedbackRouter } from './routes/feedback.js';
import { categoriesRouter } from './routes/categories.js';

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 'loopback'); // only a proxy on this same machine is trusted
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",
    });
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  // Browsers only add this header from our own pages, which blocks cross-site form posts (CSRF) on top of SameSite cookies.
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-requested-with') !== 'audit-app') return next(new HttpError(403, 'Request blocked (missing security header).'));
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', attachUser(db));
  app.use('/api/auth', authRouter(db));
  app.use('/api', dataRouter(db));
  app.use('/api/uploads', uploadsRouter(db));
  app.use('/api/reports', reportsRouter(db));
  app.use('/api/feedback', feedbackRouter(db));
  app.use('/api/categories', categoriesRouter(db));
  app.use('/api', adminRouter(db));
  app.use('/api', (req, res, next) => next(new HttpError(404, 'Not found')));

  if (fs.existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get('*', (req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `The file is larger than ${Math.round(config.maxUploadBytes / 1048576)} MB.` });
    if (err?.name === 'ZodError') return res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ') });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request body.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server. Please try again; if it keeps happening contact your administrator.' });
  });
  return app;
}
