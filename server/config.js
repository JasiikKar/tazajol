const crypto = require('crypto');
const path = require('path');
module.exports = {
  port: +process.env.PORT || 3000,
  databaseUrl: process.env.DATABASE_URL || 'postgres://tj:tj@localhost:5432/tazajol',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123', // change in real use
  tokenSecret: process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex'),
  duplicateRadiusM: +process.env.DUP_RADIUS_M || 50,
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'),
  maxPhotoBytes: 1024 * 1024,
  // rough bounding box that contains Almaty Region (sanity check for coordinates)
  regionBBox: { minLat: 42.0, maxLat: 46.5, minLng: 74.0, maxLng: 81.0 },
};
