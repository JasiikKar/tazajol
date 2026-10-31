const { AppError } = require('../errors');
const state = require('./statusState');

class ReportService {
  constructor({ repo, duplicateStrategy, bus, config }) { Object.assign(this, { repo, duplicateStrategy, bus, config }); this._cats = null; }

  async categoryKeys() { if (!this._cats) this._cats = (await this.repo.categories()).map((c) => c.key); return this._cats; }
  withNext(r) { return r && { ...r, allowedNext: state.allowedNext(r.status) }; }

  async create(input, user) {
    const lat = Number(input.lat), lng = Number(input.lng), b = this.config.regionBBox;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new AppError(400, 'BAD_LOCATION');
    if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) throw new AppError(400, 'OUT_OF_REGION');
    if (!(await this.categoryKeys()).includes(input.category)) throw new AppError(400, 'BAD_CATEGORY');
    const description = String(input.description || '').trim().slice(0, 500);
    const clientRef = input.clientRef ? String(input.clientRef).slice(0, 64) : null;

    if (!input.force) {
      const dupId = await this.duplicateStrategy.findDuplicateId({ category: input.category, lat, lng });
      if (dupId) throw new AppError(409, 'DUPLICATE', { duplicate: this.withNext(await this.repo.findById(dupId, user.id)) });
    }
    const settlement = await this.repo.nearestAreaName(lat, lng);
    const { id, existing } = await this.repo.createReport({ category: input.category, description, photoUrl: input.photoUrl || null, lat, lng, settlement, authorId: user.id, clientRef });
    return { report: this.withNext(await this.repo.findById(id, user.id)), existing };
  }

  list(q, user) { return this.repo.list({ ...q, userId: user.id, includeHidden: user.role === 'admin' }).then((rows) => rows.map((r) => this.withNext(r))); }

  async get(id, user) {
    const r = await this.repo.findById(id, user.id, user.role === 'admin');
    if (!r) throw new AppError(404, 'NOT_FOUND');
    return this.withNext(r);
  }

  async vote(id, user) {
    await this.get(id, user);
    const added = await this.repo.addVote(id, user.id);
    return { added, report: await this.get(id, user) };
  }

  async changeStatus(id, to, user) {
    const r = await this.get(id, user);
    if (!state.STATUSES.includes(to)) throw new AppError(400, 'BAD_STATUS');
    if (!state.canMove(r.status, to)) throw new AppError(422, 'INVALID_TRANSITION', { from: r.status, to });
    if (!(await this.repo.updateStatus(id, r.status, to, user.id))) throw new AppError(409, 'STATUS_CHANGED');
    this.bus.emit('status.changed', { id, from: r.status, to, by: user.id });
    return this.get(id, user);
  }

  async setHidden(id, hidden) { if (!(await this.repo.setHidden(id, hidden))) throw new AppError(404, 'NOT_FOUND'); }
}
module.exports = { ReportService };
