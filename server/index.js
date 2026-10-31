const fs = require('fs');
const path = require('path');
const config = require('./config');
const { createApp } = require('./app');
const { seed } = require('./db/seed');

(async () => {
  const { app, pool, repo } = createApp();
  await repo.init(fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8'));
  await seed(pool);
  if (config.adminPassword === 'admin123') console.warn('WARNING: using default admin password. Set ADMIN_PASSWORD.');
  app.listen(config.port, () => console.log(`TazaJol running on http://localhost:${config.port}`));
})().catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });
