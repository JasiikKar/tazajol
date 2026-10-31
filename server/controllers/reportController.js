const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { AppError } = require('../errors');
const { toOpen311 } = require('../services/open311Adapter');

// Controllers: routes + request validation only. Rules live in the service layer.
function reportController({ service, repo, auth, config }) {
  const router = express.Router();
  const writeLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: +process.env.RATE_LIMIT || 60, standardHeaders: true, legacyHeaders: false });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_q, _f, cb) => { fs.mkdirSync(config.uploadDir, { recursive: true }); cb(null, config.uploadDir); },
      filename: (_q, f, cb) => cb(null, crypto.randomBytes(12).toString('hex') + (f.mimetype === 'image/png' ? '.png' : '.jpg')),
    }),
    limits: { fileSize: config.maxPhotoBytes, files: 1 },
    fileFilter: (_q, f, cb) => (['image/jpeg', 'image/png'].includes(f.mimetype) ? cb(null, true) : cb(new AppError(400, 'BAD_FILE_TYPE'))),
  });
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  router.post('/auth/admin-login', writeLimit, express.json(), wrap(async (req, res) => res.json({ token: auth.login(req.body && req.body.password) })));
  router.get('/areas', wrap(async (_q, res) => res.json(await repo.areas())));
  router.get('/categories', wrap(async (_q, res) => res.json(await repo.categories())));

  router.use(auth.identify); // everything below needs a user id

  router.get('/reports', wrap(async (req, res) => {
    let bbox = null;
    if (req.query.bbox) {
      bbox = String(req.query.bbox).split(',').map(Number); // minLng,minLat,maxLng,maxLat
      if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) throw new AppError(400, 'BAD_BBOX');
    }
    const statuses = req.query.status ? String(req.query.status).split(',') : null;
    res.json(await service.list({ bbox, statuses }, req.user));
  }));

  router.get('/reports/:id', wrap(async (req, res) => res.json(await service.get(+req.params.id, req.user))));

  router.post('/reports', writeLimit, upload.single('photo'), wrap(async (req, res) => {
    try {
      const b = req.body;
      const { report, existing } = await service.create({
        category: b.category, description: b.description, lat: b.lat, lng: b.lng,
        force: b.force === '1' || b.force === 'true', clientRef: b.ref,
        photoUrl: req.file ? '/uploads/' + req.file.filename : null,
      }, req.user);
      if (existing && req.file) fs.unlink(req.file.path, () => {});
      res.status(existing ? 200 : 201).json(report);
    } catch (e) { if (req.file) fs.unlink(req.file.path, () => {}); throw e; }
  }));

  router.post('/reports/:id/votes', writeLimit, wrap(async (req, res) => res.json(await service.vote(+req.params.id, req.user))));

  router.patch('/reports/:id/status', auth.requireAdmin, express.json(), wrap(async (req, res) =>
    res.json(await service.changeStatus(+req.params.id, req.body && req.body.status, req.user))));

  router.post('/reports/:id/hide', auth.requireAdmin, wrap(async (req, res) => { await service.hide(+req.params.id); res.status(204).end(); }));

  router.get('/notifications', wrap(async (req, res) => res.json(await repo.notifications(req.user.id))));
  router.post('/notifications/read', wrap(async (req, res) => { await repo.markNotificationsRead(req.user.id); res.status(204).end(); }));

  // Adapter output (format conversion only, no akimat connection)
  router.get('/open311/requests.json', wrap(async (req, res) => {
    const rows = await service.list({ bbox: null, statuses: null }, req.user);
    res.json(rows.map((r) => toOpen311(r, req.protocol + '://' + req.get('host'))));
  }));
  return router;
}
module.exports = { reportController };
