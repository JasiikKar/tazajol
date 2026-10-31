const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const config = require('./config');
const { AppError } = require('./errors');
const { ReportRepository } = require('./repositories/reportRepository');
const { SameCategoryWithinRadius } = require('./services/duplicateStrategy');
const { createBus } = require('./services/eventBus');
const { registerNotifier } = require('./services/notifier');
const { ReportService } = require('./services/reportService');
const { makeAuth } = require('./auth');
const { reportController } = require('./controllers/reportController');

// Composition root: wires the layers together (controllers -> services -> repositories).
function createApp(overrides = {}) {
  const cfg = { ...config, ...overrides };
  const pool = new Pool({ connectionString: cfg.databaseUrl });
  const repo = new ReportRepository(pool);
  const bus = createBus();
  registerNotifier(bus, repo);
  const service = new ReportService({ repo, duplicateStrategy: new SameCategoryWithinRadius(repo, cfg.duplicateRadiusM), bus, config: cfg });
  const auth = makeAuth(cfg, repo);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Render's proxy: needed for correct client IPs / rate limiting
  app.use('/vendor/leaflet', express.static(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist')));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api', reportController({ service, repo, auth, config: cfg }));

  app.use((err, _req, res, _next) => {
    if (err instanceof AppError) return res.status(err.status).json({ code: err.code, ...err.extra });
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ code: 'PHOTO_TOO_LARGE' });
    console.error(err);
    res.status(500).json({ code: 'SERVER_ERROR' });
  });
  return { app, pool, repo, service, bus };
}
module.exports = { createApp };
