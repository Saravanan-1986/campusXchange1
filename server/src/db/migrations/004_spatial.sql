-- ============================================================================
-- CampusXchange · PostgreSQL layer · migration 004 — SPATIAL
-- ----------------------------------------------------------------------------
-- The spatial layer is written twice and installed once, depending on what the
-- server actually has:
--
--   PostGIS available       → geography(Point,4326) + ST_DWithin on a GiST index
--   otherwise (this box)    → cube + earthdistance: earth_box @> earth (GiST)
--                             prefilter, then exact earth_distance in metres
--   neither                 → bounding-box prefilter + haversine
--
-- Switch providers by installing PostGIS and re-running the migrations — the
-- API detects the provider at boot and reports it in /api/system/status.
-- ============================================================================

-- --- Nearest campus zone (used by the spatial trigger) ----------------------
CREATE OR REPLACE FUNCTION cx_nearest_zone(p_lat double precision, p_lon double precision)
RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT z.zone_id
  FROM campus_zone z
  ORDER BY cx_distance_m(p_lat, p_lon, z.lat, z.lon)
  LIMIT 1;
$$;

-- --- Radius search over resources ------------------------------------------
DO $$
DECLARE
  v_provider text := cx_spatial_provider();
  v_body     text;
BEGIN
  IF v_provider = 'postgis' THEN
    v_body := $body$
      SELECT g.resource_id,
             m.title,
             m.category,
             m.subject,
             m.department,
             m.semester,
             m.condition,
             m.price,
             m.availability,
             m.listing_type,
             m.owner_id,
             m.owner_label,
             g.lat,
             g.lon,
             g.label       AS place_label,
             z.name        AS zone_name,
             z.zone_id,
             cx_distance_m(p_lat, p_lon, g.lat, g.lon)::numeric(10,1) AS distance_m
      FROM geo_resource g
      JOIN resource_mirror m ON m.resource_id = g.resource_id
      LEFT JOIN campus_zone z ON z.zone_id = g.zone_id
      WHERE ST_DWithin(g.geom,
                       ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
                       p_radius_m)
        AND m.status = 'active'
        AND (NOT p_only_available OR m.availability = 'available')
      ORDER BY g.geom <-> ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography
      LIMIT 250;
    $body$;
  ELSIF v_provider = 'earthdistance' THEN
    v_body := $body$
      SELECT g.resource_id,
             m.title,
             m.category,
             m.subject,
             m.department,
             m.semester,
             m.condition,
             m.price,
             m.availability,
             m.listing_type,
             m.owner_id,
             m.owner_label,
             g.lat,
             g.lon,
             g.label       AS place_label,
             z.name        AS zone_name,
             z.zone_id,
             cx_distance_m(p_lat, p_lon, g.lat, g.lon)::numeric(10,1) AS distance_m
      FROM geo_resource g
      JOIN resource_mirror m ON m.resource_id = g.resource_id
      LEFT JOIN campus_zone z ON z.zone_id = g.zone_id
      WHERE earth_box(ll_to_earth(p_lat, p_lon), p_radius_m) @> g.earth      -- GiST prefilter
        AND cx_distance_m(p_lat, p_lon, g.lat, g.lon) <= p_radius_m          -- exact filter
        AND m.status = 'active'
        AND (NOT p_only_available OR m.availability = 'available')
      ORDER BY g.earth <-> ll_to_earth(p_lat, p_lon)
      LIMIT 250;
    $body$;
  ELSE
    v_body := $body$
      SELECT g.resource_id, m.title, m.category, m.subject, m.department, m.semester,
             m.condition, m.price, m.availability, m.listing_type, m.owner_id, m.owner_label,
             g.lat, g.lon, g.label AS place_label, z.name AS zone_name, z.zone_id,
             cx_distance_m(p_lat, p_lon, g.lat, g.lon)::numeric(10,1) AS distance_m
      FROM geo_resource g
      JOIN resource_mirror m ON m.resource_id = g.resource_id
      LEFT JOIN campus_zone z ON z.zone_id = g.zone_id
      WHERE g.lat BETWEEN p_lat - (p_radius_m / 111320.0)
                      AND p_lat + (p_radius_m / 111320.0)
        AND g.lon BETWEEN p_lon - (p_radius_m / (111320.0 * cos(radians(p_lat))))
                      AND p_lon + (p_radius_m / (111320.0 * cos(radians(p_lat))))
        AND cx_distance_m(p_lat, p_lon, g.lat, g.lon) <= p_radius_m
        AND m.status = 'active'
        AND (NOT p_only_available OR m.availability = 'available')
      ORDER BY distance_m
      LIMIT 250;
    $body$;
  END IF;

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION cx_nearby_resources(
      p_lat double precision,
      p_lon double precision,
      p_radius_m double precision,
      p_only_available boolean DEFAULT true
    ) RETURNS TABLE (
      resource_id text, title text, category text, subject text, department text, semester smallint,
      condition text, price numeric, availability text, listing_type text,
      owner_id text, owner_label text, lat double precision, lon double precision,
      place_label text, zone_name text, zone_id text, distance_m numeric
    ) LANGUAGE sql STABLE AS %L
  $fn$, v_body);

  RAISE NOTICE 'CampusXchange: spatial provider = %', v_provider;
END $$;
-- --- Radius search over students (same provider strategy) -------------------
DO $$
DECLARE
  v_body text;
BEGIN
  IF cx_spatial_provider() = 'postgis' THEN
    v_body := $body$
      SELECT u.user_id, u.name, u.department, u.role, u.lat, u.lon, u.label,
             z.name AS zone_name,
             cx_distance_m(p_lat, p_lon, u.lat, u.lon)::numeric(10,1) AS distance_m
      FROM geo_user u
      LEFT JOIN campus_zone z ON z.zone_id = u.zone_id
      WHERE ST_DWithin(u.geom, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography, p_radius_m)
      ORDER BY u.geom <-> ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography
      LIMIT 150;
    $body$;
  ELSE
    v_body := $body$
      SELECT u.user_id, u.name, u.department, u.role, u.lat, u.lon, u.label,
             z.name AS zone_name,
             cx_distance_m(p_lat, p_lon, u.lat, u.lon)::numeric(10,1) AS distance_m
      FROM geo_user u
      LEFT JOIN campus_zone z ON z.zone_id = u.zone_id
      WHERE u.lat BETWEEN p_lat - (p_radius_m / 111320.0) AND p_lat + (p_radius_m / 111320.0)
        AND u.lon BETWEEN p_lon - (p_radius_m / (111320.0 * cos(radians(p_lat))))
                      AND p_lon + (p_radius_m / (111320.0 * cos(radians(p_lat))))
        AND cx_distance_m(p_lat, p_lon, u.lat, u.lon) <= p_radius_m
      ORDER BY distance_m
      LIMIT 150;
    $body$;
  END IF;

  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION cx_nearby_students(
      p_lat double precision, p_lon double precision, p_radius_m double precision
    ) RETURNS TABLE (
      user_id text, name text, department text, role text,
      lat double precision, lon double precision, label text,
      zone_name text, distance_m numeric
    ) LANGUAGE sql STABLE AS %L
  $fn$, v_body);
END $$;

-- --- Campus zones ranked by distance ---------------------------------------
CREATE OR REPLACE FUNCTION cx_nearby_zones(
  p_lat double precision,
  p_lon double precision,
  p_limit integer DEFAULT 10
) RETURNS TABLE (
  zone_id text, name text, kind text, lat double precision, lon double precision,
  distance_m numeric, resources bigint
)
LANGUAGE sql STABLE AS $$
  SELECT z.zone_id, z.name, z.kind, z.lat, z.lon,
         cx_distance_m(p_lat, p_lon, z.lat, z.lon)::numeric(10,1) AS distance_m,
         (SELECT count(*) FROM geo_resource g WHERE g.zone_id = z.zone_id) AS resources
  FROM campus_zone z
  ORDER BY distance_m
  LIMIT greatest(p_limit, 1);
$$;
-- --- Density grid: bucket geo points into cells (map clustering, pure SQL) ---
CREATE OR REPLACE FUNCTION cx_density_grid(
  p_cell_deg double precision DEFAULT 0.002
) RETURNS TABLE (
  cell_lat double precision, cell_lon double precision, resources bigint, students bigint
)
LANGUAGE sql STABLE AS $$
  WITH cells AS (
    SELECT floor(lat / p_cell_deg) * p_cell_deg AS cell_lat,
           floor(lon / p_cell_deg) * p_cell_deg AS cell_lon,
           'resource' AS kind
      FROM geo_resource
    UNION ALL
    SELECT floor(lat / p_cell_deg) * p_cell_deg,
           floor(lon / p_cell_deg) * p_cell_deg,
           'student'
      FROM geo_user
  )
  SELECT cell_lat,
         cell_lon,
         count(*) FILTER (WHERE kind = 'resource') AS resources,
         count(*) FILTER (WHERE kind = 'student')  AS students
  FROM cells
  GROUP BY cell_lat, cell_lon
  HAVING count(*) > 0
  ORDER BY (count(*) FILTER (WHERE kind = 'resource')) + (count(*) FILTER (WHERE kind = 'student')) DESC
  LIMIT 200;
$$;

-- --- Per-zone rollup (SQL GROUP BY across the spatial + document layers) ----
CREATE OR REPLACE FUNCTION cx_zone_summary()
RETURNS TABLE (
  zone_id text, zone_name text, kind text,
  resources bigint, available bigint, students bigint,
  avg_price numeric, total_value numeric
)
LANGUAGE sql STABLE AS $$
  SELECT z.zone_id,
         z.name,
         z.kind,
         count(g.resource_id)                                              AS resources,
         count(g.resource_id) FILTER (WHERE m.availability = 'available')   AS available,
         (SELECT count(*) FROM geo_user u WHERE u.zone_id = z.zone_id)      AS students,
         coalesce(round(avg(m.price) FILTER (WHERE m.listing_type = 'sell'), 2), 0) AS avg_price,
         coalesce(sum(m.price) FILTER (WHERE m.availability = 'available'), 0)      AS total_value
  FROM campus_zone z
  LEFT JOIN geo_resource g ON g.zone_id = z.zone_id
  LEFT JOIN resource_mirror m ON m.resource_id = g.resource_id AND m.status = 'active'
  GROUP BY z.zone_id, z.name, z.kind
  ORDER BY resources DESC, z.name;
$$;

-- ============================================================================
-- SPATIAL TRIGGER — every geo write is snapped to its nearest campus zone.
-- The application never computes this; the database does it, on write.
-- ============================================================================
CREATE OR REPLACE FUNCTION cx_trg_snap_zone() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  -- Re-resolve only when the coordinates moved, or when the zone is unknown.
  IF TG_OP = 'INSERT'
     OR NEW.lat IS DISTINCT FROM OLD.lat
     OR NEW.lon IS DISTINCT FROM OLD.lon
     OR NEW.zone_id IS NULL THEN
    NEW.zone_id := cx_nearest_zone(NEW.lat, NEW.lon);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_geo_resource_zone_t ON geo_resource;
CREATE TRIGGER trg_geo_resource_zone_t
  BEFORE INSERT OR UPDATE ON geo_resource
  FOR EACH ROW EXECUTE FUNCTION cx_trg_snap_zone();

DROP TRIGGER IF EXISTS trg_geo_user_zone_t ON geo_user;
CREATE TRIGGER trg_geo_user_zone_t
  BEFORE INSERT OR UPDATE ON geo_user
  FOR EACH ROW EXECUTE FUNCTION cx_trg_snap_zone();

-- Convenience view for the map: resources with zone + place label.
CREATE OR REPLACE VIEW v_resource_location AS
SELECT g.resource_id,
       m.title,
       m.category,
       m.price,
       m.availability,
       m.listing_type,
       m.owner_id,
       g.lat,
       g.lon,
       g.label AS place_label,
       z.name  AS zone_name,
       z.zone_id
FROM geo_resource g
JOIN resource_mirror m ON m.resource_id = g.resource_id
LEFT JOIN campus_zone z ON z.zone_id = g.zone_id
WHERE m.status = 'active';
