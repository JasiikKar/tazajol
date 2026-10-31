// Reference data (categories, settlements) and a few demo reports. Safe to run many times.
const CATS = [
  ['road', 'Дороги', 'Жолдар', 'Roads'], ['light', 'Освещение', 'Жарық', 'Lighting'], ['trash', 'Мусор', 'Қоқыс', 'Trash'],
  ['play', 'Детская площадка', 'Балалар алаңы', 'Playground'], ['build', 'Стройка', 'Құрылыс', 'Construction damage'], ['other', 'Другое', 'Басқа', 'Other'],
];
// Approximate settlement centres (reference points for the selector, not survey data)
const AREAS = [
  ['Zhetygen', 'Iliysk district', 43.37, 77.06], ['Koyankus', 'Almaty Region', 43.30, 76.78], ['Talgar', 'Talgar district', 43.30, 77.24],
  ['Esik', 'Yesik', 43.35, 77.45], ['Kaskelen', 'Karasay district', 43.20, 76.63], ['Konaev', 'Konaev city', 43.87, 77.07],
];
const DEMO = [
  ['road', 'Pothole near the school (demo)', 43.372, 77.058], ['light', 'Streetlight not working (demo)', 43.298, 76.785],
  ['build', 'Trench left open after works (demo)', 43.302, 77.238], ['trash', 'Overflowing bins (demo)', 43.348, 77.452],
];
async function seed(pool) {
  for (const c of CATS) await pool.query('INSERT INTO categories VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', c);
  for (const a of AREAS) await pool.query('INSERT INTO areas(name,district,lat,lng) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', a);
  const { rows } = await pool.query('SELECT count(*)::int n FROM reports');
  if (rows[0].n === 0) {
    await pool.query("INSERT INTO users(id, role) VALUES('demo-user-00', 'resident') ON CONFLICT DO NOTHING");
    for (const [cat, desc, lat, lng] of DEMO) {
      const r = await pool.query(
        `INSERT INTO reports(category, description, location, settlement, author_id)
         VALUES($1,$2,ST_SetSRID(ST_MakePoint($4,$3),4326)::geography,(SELECT name FROM areas ORDER BY ST_Distance(ST_SetSRID(ST_MakePoint($4,$3),4326)::geography, ST_SetSRID(ST_MakePoint(lng,lat),4326)::geography) LIMIT 1),'demo-user-00') RETURNING id`, [cat, desc, lat, lng]);
      await pool.query("INSERT INTO votes VALUES($1,'demo-user-00')", [r.rows[0].id]);
      await pool.query("INSERT INTO status_events(report_id, old_status, new_status, changed_by) VALUES($1,NULL,'new','demo-user-00')", [r.rows[0].id]);
    }
  }
}
module.exports = { seed };
if (require.main === module) {
  const { Pool } = require('pg'); const fs = require('fs'); const path = require('path');
  const pool = new Pool({ connectionString: require('../config').databaseUrl });
  pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')).then(() => seed(pool)).then(() => { console.log('seeded'); pool.end(); }).catch((e) => { console.error(e.message); process.exit(1); });
}
