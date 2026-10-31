// Repository pattern: ALL SQL lives here. Services never build queries.
const REPORT_COLS = `r.id, r.category, r.description, r.photo_url AS "photoUrl", r.settlement, r.status,
  r.created_at AS "createdAt", ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng,
  (SELECT count(*) FROM votes v WHERE v.report_id = r.id)::int AS votes,
  EXISTS (SELECT 1 FROM votes v WHERE v.report_id = r.id AND v.user_id = $1) AS voted`;

class ReportRepository {
  constructor(pool) { this.pool = pool; }

  async init(schemaSql) { await this.pool.query(schemaSql); }
  async ensureUser(id) { await this.pool.query('INSERT INTO users(id) VALUES($1) ON CONFLICT DO NOTHING', [id]); }
  async categories() { return (await this.pool.query('SELECT * FROM categories ORDER BY key')).rows; }
  async areas() { return (await this.pool.query('SELECT id, name, district, lat, lng FROM areas ORDER BY name')).rows; }

  async nearestAreaName(lat, lng) {
    const { rows } = await this.pool.query(
      `SELECT name FROM areas
       ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint($2,$1),4326)::geography, ST_SetSRID(ST_MakePoint(lng,lat),4326)::geography) LIMIT 1`, [lat, lng]);
    return rows[0] ? rows[0].name : null;
  }

  // Returns { id, existing } ; existing=true when client_ref was already stored (idempotent outbox retries)
  async createReport(r) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const ins = await c.query(
        `INSERT INTO reports(category, description, photo_url, location, settlement, author_id, client_ref)
         VALUES($1,$2,$3,ST_SetSRID(ST_MakePoint($5,$4),4326)::geography,$6,$7,$8)
         ON CONFLICT (client_ref) DO NOTHING RETURNING id`,
        [r.category, r.description, r.photoUrl, r.lat, r.lng, r.settlement, r.authorId, r.clientRef]);
      if (!ins.rows.length) { await c.query('ROLLBACK'); const e = await this.pool.query('SELECT id FROM reports WHERE client_ref=$1', [r.clientRef]); return { id: e.rows[0].id, existing: true }; }
      const id = ins.rows[0].id;
      await c.query('INSERT INTO votes(report_id, user_id) VALUES($1,$2)', [id, r.authorId]);
      await c.query('INSERT INTO status_events(report_id, old_status, new_status, changed_by) VALUES($1,NULL,$2,$3)', [id, 'new', r.authorId]);
      await c.query('COMMIT');
      return { id, existing: false };
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }

  async findById(id, userId) {
    const { rows } = await this.pool.query(`SELECT ${REPORT_COLS} FROM reports r WHERE r.id = $2 AND NOT r.hidden`, [userId, id]);
    if (!rows[0]) return null;
    const h = await this.pool.query('SELECT old_status AS "from", new_status AS "to", created_at AS at FROM status_events WHERE report_id=$1 ORDER BY id', [id]);
    return { ...rows[0], history: h.rows };
  }

  async list({ bbox, statuses, userId, limit = 500 }) {
    const params = [userId]; const where = ['NOT r.hidden'];
    if (bbox) { params.push(...bbox); where.push(`r.location && ST_MakeEnvelope($${params.length - 3},$${params.length - 2},$${params.length - 1},$${params.length},4326)::geography`); }
    if (statuses && statuses.length) { params.push(statuses); where.push(`r.status = ANY($${params.length})`); }
    params.push(limit);
    const { rows } = await this.pool.query(
      `SELECT ${REPORT_COLS} FROM reports r WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT $${params.length}`, params);
    return rows;
  }

  // PostGIS distance query used by the duplicate-detection Strategy
  async findOpenNearbyId(category, lat, lng, radiusM) {
    const { rows } = await this.pool.query(
      `SELECT r.id FROM reports r
       WHERE NOT r.hidden AND r.status <> 'fixed' AND r.category = $1
         AND ST_DWithin(r.location, ST_SetSRID(ST_MakePoint($3,$2),4326)::geography, $4)
       ORDER BY ST_Distance(r.location, ST_SetSRID(ST_MakePoint($3,$2),4326)::geography) LIMIT 1`,
      [category, lat, lng, radiusM]);
    return rows[0] ? rows[0].id : null;
  }

  async addVote(reportId, userId) {
    const r = await this.pool.query('INSERT INTO votes(report_id, user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [reportId, userId]);
    return r.rowCount === 1;
  }

  // optimistic: only updates if the status is still what the service saw
  async updateStatus(id, from, to, changedBy) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const u = await c.query('UPDATE reports SET status=$3 WHERE id=$1 AND status=$2', [id, from, to]);
      if (u.rowCount !== 1) { await c.query('ROLLBACK'); return false; }
      await c.query('INSERT INTO status_events(report_id, old_status, new_status, changed_by) VALUES($1,$2,$3,$4)', [id, from, to, changedBy]);
      await c.query('COMMIT'); return true;
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }

  async hide(id) { return (await this.pool.query('UPDATE reports SET hidden=true WHERE id=$1', [id])).rowCount === 1; }

  async notifyVoters(reportId, newStatus, exceptUserId) {
    await this.pool.query(
      `INSERT INTO notifications(user_id, report_id, new_status)
       SELECT user_id, $1, $2 FROM votes WHERE report_id=$1 AND user_id <> $3`, [reportId, newStatus, exceptUserId]);
  }
  async notifications(userId) {
    return (await this.pool.query(
      `SELECT n.id, n.report_id AS "reportId", n.new_status AS "newStatus", n.read, n.created_at AS "createdAt", r.category
       FROM notifications n JOIN reports r ON r.id = n.report_id WHERE n.user_id=$1 ORDER BY n.id DESC LIMIT 50`, [userId])).rows;
  }
  async markNotificationsRead(userId) { await this.pool.query('UPDATE notifications SET read=true WHERE user_id=$1', [userId]); }
}
module.exports = { ReportRepository };
