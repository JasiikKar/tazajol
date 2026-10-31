# TazaJol (prototype)

Local problem reporting and tracking for Almaty Region. Everyone sees every report on one shared map, can upvote duplicates and follow the status. The admin changes statuses and can hide/restore reports. Mobile-first design (white, green, yellow).

## Architecture

| Tier / layer | Where | Notes |
|---|---|---|
| Client: mobile web app (PWA) | `public/` | Leaflet + OpenStreetMap, report form, offline queue, service worker, Kazakh/Russian/English |
| Server: Controllers | `server/controllers/` | Routes, validation, uploads, rate limiting |
| Server: Services | `server/services/` | Duplicate detection, status rules, notifications |
| Server: Repositories | `server/repositories/` | All SQL (PostgreSQL + PostGIS) |
| Data | `server/db/schema.sql` | PostGIS database. Photos are stored in the database (`photos` table) |
| Open311 adapter | `server/services/open311Adapter.js` | Format converter only, not connected to any akimat |

Patterns: Layered, Repository, State, Strategy, Observer, Adapter, Outbox.

## Run locally

1. Install Node.js 20+ and PostgreSQL with PostGIS (or `docker compose up -d`). Create DB `tazajol` and run `CREATE EXTENSION postgis;`
2. `npm install`
3. Windows cmd: `set DATABASE_URL=postgres://postgres:PASSWORD@localhost:5432/tazajol` then `set ADMIN_PASSWORD=choose-one` then `npm start`
   (PowerShell: `$env:DATABASE_URL="..."`. Mac/Linux: `DATABASE_URL=... ADMIN_PASSWORD=... npm start`)
4. Open http://localhost:3000. Tests: `npm test`. Add `?debug=1` to the address to show the "simulate no connection" switch.

## Deploy for free (Neon database + Render web service)

You need free accounts on GitHub, Neon and Render. Free-tier rules change, so check each pricing page.

**1. Database (Neon)**
1. neon.tech > sign up > Create project. Pick a region close to you (Europe/Frankfurt).
2. On the project page click **Connect** and copy the connection string (starts with `postgres://` and ends with `?sslmode=require`). Keep it secret.
3. Nothing else: the app enables PostGIS and creates its tables on first start.

**2. Code (GitHub)**
1. github.com > New repository (private is fine) > name it `tazajol`.
2. Upload the project files (everything except `node_modules`). On the website: *Add file > Upload files*, then drag in the contents of this folder. Make sure `package.json` is at the top level of the repo.

**3. Web service (Render)**
1. render.com > New + > **Web Service** > connect the GitHub repo.
2. Settings: Language **Node**, Region **Frankfurt**, Branch `main`, Build Command `npm install`, Start Command `npm start`, Instance Type **Free**.
3. Environment variables: `DATABASE_URL` = the Neon string; `ADMIN_PASSWORD` = a strong password; `TOKEN_SECRET` = any long random text.
4. Create Web Service. After the build, Render shows your address, `https://something.onrender.com`. Share it.
(Alternatively: New + > Blueprint uses `render.yaml` and asks for the same values.)

**Free-tier behaviour:** the free server sleeps after about 15 minutes without visits and takes about a minute to wake. Open the link a few minutes before a demo. The free Neon database has a 0.5 GB limit; photos are about 100-150 KB each.

## API

`GET /api/health` · `GET /api/areas` · `GET /api/categories` · `GET /api/photos/:id` · `GET /api/reports?bbox=minLng,minLat,maxLng,maxLat&status=...` · `GET /api/reports/:id` · `POST /api/reports` (multipart; 201, or 409 `DUPLICATE`) · `POST /api/reports/:id/votes` · `PATCH /api/reports/:id/status` (admin) · `POST /api/reports/:id/hide|unhide` (admin) · `GET/POST /api/notifications` · `POST /api/auth/admin-login` · `GET /api/open311/requests.json`. Send header `X-User-Id` (the app creates one per device).

## Known limitations (prototype)

- Residents are anonymous device ids; only the admin has a password. Anyone with the link can post, so the admin should watch for junk (hide button, rate limit per IP).
- Photo metadata is removed in the browser; the server checks type, size and file signature.
- Map tiles come from openstreetmap.org (fine for a prototype; heavy use needs another provider).
- Not connected to akimat systems.
- Automated tests cover the API against a real PostGIS database (16 tests). The browser UI was tested in a simulated browser, not on real phones.
