CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, name text, lang text DEFAULT 'ru',
  role text NOT NULL DEFAULT 'resident', created_at timestamptz DEFAULT now());

CREATE TABLE IF NOT EXISTS categories (
  key text PRIMARY KEY, name_ru text, name_kk text, name_en text);

CREATE TABLE IF NOT EXISTS areas (
  id serial PRIMARY KEY, name text UNIQUE NOT NULL, district text,
  lat double precision NOT NULL, lng double precision NOT NULL);

CREATE TABLE IF NOT EXISTS photos (
  id serial PRIMARY KEY, mime text NOT NULL, data bytea NOT NULL, created_at timestamptz DEFAULT now());

CREATE TABLE IF NOT EXISTS reports (
  id serial PRIMARY KEY,
  category text NOT NULL REFERENCES categories(key),
  description text DEFAULT '',
  photo_url text,
  location geography(Point, 4326) NOT NULL,
  settlement text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','fixed')),
  hidden boolean NOT NULL DEFAULT false,
  author_id text REFERENCES users(id),
  client_ref text UNIQUE,
  created_at timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS reports_location_gix ON reports USING gist (location);

CREATE TABLE IF NOT EXISTS votes (
  report_id int REFERENCES reports(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (report_id, user_id));

CREATE TABLE IF NOT EXISTS status_events (
  id serial PRIMARY KEY,
  report_id int REFERENCES reports(id) ON DELETE CASCADE,
  old_status text, new_status text NOT NULL, changed_by text,
  created_at timestamptz DEFAULT now());

CREATE TABLE IF NOT EXISTS notifications (
  id serial PRIMARY KEY,
  user_id text REFERENCES users(id),
  report_id int REFERENCES reports(id) ON DELETE CASCADE,
  new_status text NOT NULL, read boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now());
