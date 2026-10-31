# TazaJol (prototype)

Local problem reporting and tracking for Almaty Region. Residents report a problem with a photo and location, see everyone's reports on one map, upvote duplicates, and follow the status. An admin changes the status.

## Architecture (matches the architecture document)

| Tier / layer | Where | Notes |
|---|---|---|
| Client: mobile web app (PWA) | `public/` | Leaflet + OpenStreetMap tiles, report form, offline queue, service worker, Kazakh/Russian/English |
| Server: Controllers | `server/controllers/` | Routes, validation, uploads, rate limiting |
| Server: Services | `server/services/` | Rules: duplicate detection, status changes, notifications |
| Server: Repositories | `server/repositories/` | All SQL (PostgreSQL + PostGIS) |
| Data | `server/db/schema.sql` | PostGIS database; photos in `uploads/` |
| Open311 adapter | `server/services/open311Adapter.js` | Format converter only. NOT connected to any akimat |

Design patterns: Layered/MVC-style (folders above), Repository (`reportRepository.js`), State (`statusState.js`), Strategy (`duplicateStrategy.js`), Observer (`eventBus.js` + `notifier.js`), Adapter (`open311Adapter.js`), Outbox (`public/app.js`, IndexedDB).

## Run it

1. Install Node.js 20+ and PostgreSQL with PostGIS (or run `docker compose up -d`).
2. Create the database (skip if you used Docker):
   ```
   createuser -P tj        # password: tj
   createdb -O tj tazajol
   psql tazajol -c "CREATE EXTENSION postgis;"
   ```
3. Install and start:
   ```
   npm install
   ADMIN_PASSWORD=choose-one npm start
   ```
4. Open http://localhost:3000. Tables and sample data (settlements, categories, 4 demo reports) are created on first start.
5. Tests (need the database): `npm test`

Change the database with `DATABASE_URL`. Admin: tap "Admin" and enter the `ADMIN_PASSWORD` (default `admin123` is for local use only).

To try it on a phone, use the computer's address (e.g. `http://192.168.1.5:3000`). GPS and "install app" need HTTPS in real deployment; `localhost` is exempt.

## API

`GET /api/areas` · `GET /api/categories` · `GET /api/reports?bbox=minLng,minLat,maxLng,maxLat&status=new,in_progress` · `GET /api/reports/:id` · `POST /api/reports` (multipart: category, description, lat, lng, photo, ref, force) gives 201, or 409 `DUPLICATE` · `POST /api/reports/:id/votes` · `PATCH /api/reports/:id/status` (admin) · `POST /api/reports/:id/hide` (admin) · `GET/POST /api/notifications` · `POST /api/auth/admin-login` · `GET /api/open311/requests.json`. Send header `X-User-Id` (the app creates one per device).

## Known limitations (prototype)

- No accounts: residents are anonymous device ids; only the admin has a password. Not suitable for public deployment as is.
- Photo metadata (EXIF/GPS) is stripped in the browser by re-encoding; the server only checks file type and size.
- Map tiles come from openstreetmap.org, which is fine for a prototype; heavy use needs another tile provider (OSM tile usage policy).
- Not connected to akimat systems. Reports are not routed to any authority.
- Automated tests cover the API against a real PostGIS database. The browser UI was only smoke-tested in a simulated browser (jsdom), not on real phones.
