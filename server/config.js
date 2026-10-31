const crypto = require('crypto');
module.exports = {
  port: +process.env.PORT || 3000,
  databaseUrl: process.env.DATABASE_URL || 'postgres://tj:tj@localhost:5432/tazajol',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123', // change in real use
  tokenSecret: process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex'),
  duplicateRadiusM: +process.env.DUP_RADIUS_M || 50,
  maxPhotoBytes: 512 * 1024, // photos are stored in the database, so keep them small
  // rough bounding box that contains Almaty Region (sanity check for coordinates)
  regionBBox: { minLat: 42.0, maxLat: 46.5, minLng: 74.0, maxLng: 81.0 },
};
