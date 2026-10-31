// Prototype authentication: residents are anonymous device ids; the admin logs in with a password
// (scrypt-hashed in memory) and receives an HMAC-signed, expiring token.
const crypto = require('crypto');
const { AppError } = require('./errors');

function makeAuth(config, repo) {
  const salt = crypto.randomBytes(16);
  const adminHash = crypto.scryptSync(config.adminPassword, salt, 32);
  const sign = (s) => crypto.createHmac('sha256', config.tokenSecret).update(s).digest('base64url');

  function login(password) {
    const h = crypto.scryptSync(String(password || ''), salt, 32);
    if (!crypto.timingSafeEqual(h, adminHash)) throw new AppError(401, 'BAD_PASSWORD');
    const payload = Buffer.from(JSON.stringify({ role: 'admin', exp: Date.now() + 8 * 3600e3 })).toString('base64url');
    return payload + '.' + sign(payload);
  }
  function verify(token) {
    const [p, sig] = String(token || '').split('.');
    if (!p || !sig) return null;
    const expected = sign(p);
    if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
    const data = JSON.parse(Buffer.from(p, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  }
  async function identify(req, _res, next) {
    try {
      const id = req.get('X-User-Id');
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(id || '')) throw new AppError(400, 'MISSING_USER_ID');
      await repo.ensureUser(id);
      const bearer = (req.get('Authorization') || '').replace(/^Bearer /, '');
      req.user = { id, role: verify(bearer) ? 'admin' : 'resident' };
      next();
    } catch (e) { next(e); }
  }
  const requireAdmin = (req, _res, next) => (req.user.role === 'admin' ? next() : next(new AppError(403, 'ADMIN_ONLY')));
  return { login, identify, requireAdmin };
}
module.exports = { makeAuth };
