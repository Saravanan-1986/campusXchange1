-- ============================================================================
-- CampusXchange · PostgreSQL layer · migration 001 — core schema
-- ----------------------------------------------------------------------------
-- Paradigms covered here:
--   TEMPORAL  resource_mirror  (write-through mirror of the Mongo document)
--   ACTIVE    active_rule + active_event (the ECA registry + the outbox)
--   SPATIAL   campus_zone / geo_resource / geo_user
--   SEARCH    search_doc (tsvector generated column + GIN index)
-- Keys are the MongoDB ObjectId hex strings, so the three engines share one
-- global identifier without cross-engine joins.
-- ============================================================================

-- --- Extensions -------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS btree_gist;    -- EXCLUDE constraints on (text, range)
CREATE EXTENSION IF NOT EXISTS pg_trgm;       -- fuzzy search on titles
CREATE EXTENSION IF NOT EXISTS unaccent;
-- Spatial: PostGIS is optional. When the binaries are installed we use the full
-- geometry stack; otherwise cube + earthdistance give us an indexed radius search.
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS postgis;
      RAISE NOTICE 'CampusXchange: PostGIS detected — spatial layer upgraded to geometry.';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'CampusXchange: PostGIS present but could not be enabled (%). Using earthdistance.', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'CampusXchange: PostGIS not installed — using cube/earthdistance for the spatial layer.';
  END IF;
END $$;

-- --- Spatial provider helpers ----------------------------------------------
CREATE OR REPLACE FUNCTION cx_spatial_provider() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN 'postgis'
    WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'earthdistance') THEN 'earthdistance'
    ELSE 'bbox'
  END;
$$;

-- Great-circle distance in metres between two WGS84 points, provider-neutral.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION cx_distance_m(lat1 double precision, lon1 double precision,
                                               lat2 double precision, lon2 double precision)
      RETURNS double precision LANGUAGE sql IMMUTABLE AS $body$
        SELECT ST_Distance(
                 ST_SetSRID(ST_MakePoint(lon1, lat1), 4326)::geography,
                 ST_SetSRID(ST_MakePoint(lon2, lat2), 4326)::geography);
      $body$;
    $fn$;
  ELSE
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION cx_distance_m(lat1 double precision, lon1 double precision,
                                               lat2 double precision, lon2 double precision)
      RETURNS double precision LANGUAGE sql IMMUTABLE AS $body$
        SELECT earth_distance(ll_to_earth(lat1, lon1), ll_to_earth(lat2, lon2));
      $body$;
    $fn$;
  END IF;
END $$;

-- --- Campus locations (SPATIAL reference data) ------------------------------
CREATE TABLE IF NOT EXISTS campus_zone (
  zone_id    text PRIMARY KEY,
  name       text NOT NULL,
  kind       text NOT NULL DEFAULT 'block'
             CHECK (kind IN ('library', 'hostel', 'department', 'canteen', 'lab', 'sports', 'gate', 'block')),
  lat        double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon        double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  capacity   integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- --- Resource mirror (TEMPORAL source row for the versioned history) --------
CREATE TABLE IF NOT EXISTS resource_mirror (
  resource_id  text PRIMARY KEY,                  -- Mongo ObjectId hex
  title        text NOT NULL,
  category     text NOT NULL DEFAULT 'other',
  subject      text NOT NULL DEFAULT '',
  department   text NOT NULL DEFAULT '',
  semester     smallint,
  condition    text NOT NULL DEFAULT 'good',
  listing_type text NOT NULL DEFAULT 'sell',
  price        numeric(10, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  availability text NOT NULL DEFAULT 'available',
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  owner_id     text NOT NULL,
  owner_label  text NOT NULL DEFAULT '',
  rating_avg   numeric(3, 2) NOT NULL DEFAULT 0,
  rating_count integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resource_mirror_owner_idx ON resource_mirror (owner_id);
CREATE INDEX IF NOT EXISTS resource_mirror_facets_idx ON resource_mirror (category, availability, department);

-- --- Geospatial mirror tables (SPATIAL) -------------------------------------
CREATE TABLE IF NOT EXISTS geo_resource (
  resource_id text PRIMARY KEY,
  owner_id    text NOT NULL,
  lat         double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon         double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  label       text NOT NULL DEFAULT '',
  zone_id     text REFERENCES campus_zone(zone_id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS geo_resource_owner_idx ON geo_resource (owner_id);

CREATE TABLE IF NOT EXISTS geo_user (
  user_id    text PRIMARY KEY,
  name       text NOT NULL DEFAULT '',
  department text NOT NULL DEFAULT '',
  role       text NOT NULL DEFAULT 'student',
  lat        double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon        double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  label      text NOT NULL DEFAULT '',
  zone_id    text REFERENCES campus_zone(zone_id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Provider-specific spatial columns + indexes.
--   postgis       → geography(Point,4326) + GiST
--   earthdistance → generated cube(earth) + GiST (index-able @> prefilter)
DO $$
DECLARE
  t text;
BEGIN
  IF cx_spatial_provider() = 'postgis' THEN
    FOREACH t IN ARRAY ARRAY['geo_resource', 'geo_user', 'campus_zone'] LOOP
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'geom') THEN
        EXECUTE format('ALTER TABLE %I ADD COLUMN geom geography(Point,4326)', t);
        EXECUTE format('UPDATE %I SET geom = ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography WHERE geom IS NULL', t);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING gist (geom)', 'idx_' || t || '_geom', t);
      END IF;
    END LOOP;
  ELSIF cx_spatial_provider() = 'earthdistance' THEN
    FOREACH t IN ARRAY ARRAY['geo_resource', 'geo_user', 'campus_zone'] LOOP
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = t AND column_name = 'earth') THEN
        EXECUTE format('ALTER TABLE %I ADD COLUMN earth cube GENERATED ALWAYS AS (ll_to_earth(lat, lon)) STORED', t);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I USING gist (earth)', 'idx_' || t || '_earth', t);
      END IF;
    END LOOP;
  ELSE
    RAISE NOTICE 'CampusXchange: no spatial extension available — bbox prefilter only.';
  END IF;
END $$;

-- --- ACTIVE DB: rule registry (ECA) ----------------------------------------
-- Rules are DATA. Each row documents the Event, the Condition (SQL) and the
-- Action, while fire_count / last_fired_at are incremented by the triggers
-- themselves — live proof that the database, not the API, reacted.
CREATE TABLE IF NOT EXISTS active_rule (
  rule_id        text PRIMARY KEY,
  name           text NOT NULL,
  event          text NOT NULL,
  condition_text text NOT NULL DEFAULT '',
  action_text    text NOT NULL DEFAULT '',
  trigger_name   text NOT NULL DEFAULT '',
  enabled        boolean NOT NULL DEFAULT true,
  fire_count     bigint NOT NULL DEFAULT 0,
  last_fired_at  timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- --- ACTIVE DB: transactional outbox --------------------------------------
-- Triggers INSERT here and pg_notify() the API. The API drains the outbox with
-- FOR UPDATE SKIP LOCKED, so several API instances can consume it safely.
CREATE TABLE IF NOT EXISTS active_event (
  event_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_id         text,
  source          text NOT NULL DEFAULT 'trigger'
                  CHECK (source IN ('trigger', 'constraint', 'cron', 'app')),
  event_type      text NOT NULL,
  entity_type     text NOT NULL CHECK (entity_type IN ('resource', 'lend', 'user', 'transaction', 'material')),
  entity_id       text NOT NULL,
  actor_id        text,
  title           text NOT NULL,
  message         text NOT NULL DEFAULT '',
  link            text NOT NULL DEFAULT '',
  severity        text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'danger')),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  recipients      text[] NOT NULL DEFAULT '{}',   -- user ids addressed by the notification
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  delivery_status text NOT NULL DEFAULT 'pending'
                  CHECK (delivery_status IN ('pending', 'delivered', 'failed', 'skipped'))
);
CREATE INDEX IF NOT EXISTS active_event_pending_idx ON active_event (delivery_status, created_at);
CREATE INDEX IF NOT EXISTS active_event_entity_idx ON active_event (entity_type, entity_id, created_at DESC);

-- --- SEARCH: tsvector read-model (generated column + GIN) ------------------
CREATE TABLE IF NOT EXISTS search_doc (
  doc_id       text PRIMARY KEY,        -- resource_id or material_id
  kind         text NOT NULL CHECK (kind IN ('resource', 'material')),
  title        text NOT NULL,
  body         text NOT NULL DEFAULT '',
  tag_text     text NOT NULL DEFAULT '',   -- space-joined tags: array_to_string() is
                                           -- STABLE, so it cannot live in a generated column
  tags         text[] NOT NULL DEFAULT '{}',
  department   text NOT NULL DEFAULT '',
  subject      text NOT NULL DEFAULT '',
  category     text NOT NULL DEFAULT '',
  semester     smallint,
  price        numeric(10, 2),
  availability text,
  owner_id     text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  tsv          tsvector GENERATED ALWAYS AS (
                 setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                 setweight(to_tsvector('english', coalesce(tag_text, '')), 'B') ||
                 setweight(to_tsvector('english', coalesce(body, '')), 'C')
               ) STORED
);
CREATE INDEX IF NOT EXISTS search_doc_tsv_idx ON search_doc USING gin (tsv);
CREATE INDEX IF NOT EXISTS search_doc_title_trgm_idx ON search_doc USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS search_doc_kind_idx ON search_doc (kind, department, semester);

