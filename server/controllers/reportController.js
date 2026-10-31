const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { AppError } = require('../errors');
const { toOpen311 } = require('../services/open311Adapter');

// Controllers: routes + request validation only. Rules live in the service layer.
function reportController({ service, repo, auth, config }) {
  const router = express.Router();
  const writeLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: +process.env.RATE_LIMIT || 60, standardHeaders: true, legacyHeaders: false });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxPhotoBytes, files: 1 },
    fileFilter: (_q, f, cb) => (['image/jpeg', 'image/png'].includes(f.mimetype) ? cb(null, true) : cb(new AppError(400, 'BAD_FILE_TYPE'))),
  });
  // check the real file signature, not only the declared type
  const isImage = (b) => b.length > 3 && ((b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47));
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  router.post('/auth/admin-login', writeLimit, express.json(), wrap(async (req, res) => res.json({ token: auth.login(req.body && req.body.password) })));
  router.get('/areas', wrap(async (_q, res) => res.json(await repo.areas())));
  router.get('/categories', wrap(async (_q, res) => res.json(await repo.categories())));

  router.get('/health', wrap(async (_q, res) => { await repo.ping(); res.json({ status: 'ok' }); }));
  // photos are public (an <img> tag cannot send headers)
  router.get('/photos/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const p = Number.isInteger(id) ? await repo.getPhoto(id) : null;
    if (!p) throw new AppError(404, 'NOT_FOUND');
    res.set({ 'Content-Type': p.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=86400' }).send(p.data);
  }));

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
    let photoId = null;
    try {
      const b = req.body;
      if (req.file) {
        if (!isImage(req.file.buffer)) throw new AppError(400, 'BAD_FILE_TYPE');
        photoId = await repo.savePhoto(req.file.mimetype, req.file.buffer);
      }
      const { report, existing } = await service.create({
        category: b.category, description: b.description, lat: b.lat, lng: b.lng,
        force: b.force === '1' || b.force === 'true', clientRef: b.ref,
        photoUrl: photoId ? '/api/photos/' + photoId : null,
      }, req.user);
      if (existing && photoId) await repo.deletePhoto(photoId);
      res.status(existing ? 200 : 201).json(report);
    } catch (e) { if (photoId) await repo.deletePhoto(photoId).catch(() => {}); throw e; }
  }));

  router.post('/reports/:id/votes', writeLimit, wrap(async (req, res) => res.json(await service.vote(+req.params.id, req.user))));

  router.patch('/reports/:id/status', auth.requireAdmin, express.json(), wrap(async (req, res) =>
    res.json(await service.changeStatus(+req.params.id, req.body && req.body.status, req.user))));

  router.post('/reports/:id/hide', auth.requireAdmin, wrap(async (req, res) => { await service.setHidden(+req.params.id, true); res.status(204).end(); }));
  router.post('/reports/:id/unhide', auth.requireAdmin, wrap(async (req, res) => { await service.setHidden(+req.params.id, false); res.status(204).end(); }));

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
