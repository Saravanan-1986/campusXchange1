-- ============================================================================
-- CampusXchange · PostgreSQL layer · migration 005 — ANALYTICS & INTROSPECTION
-- ----------------------------------------------------------------------------
-- The reporting side of the platform is plain SQL: aggregates, window
-- functions, percentiles, generate_series trends and a materialized view.
-- This is the part a document store does badly — and it is what the admin
-- "SQL Analytics" tab renders.
-- ============================================================================

-- --- Materialized view: department × category performance -------------------
DROP MATERIALIZED VIEW IF EXISTS mv_campus_activity;
CREATE MATERIALIZED VIEW mv_campus_activity AS
SELECT m.department,
       m.category,
       count(*)                                              AS listings,
       count(*) FILTER (WHERE m.status = 'active')            AS active_listings,
       count(*) FILTER (WHERE m.availability = 'available')   AS available,
       count(*) FILTER (WHERE m.availability = 'lent')        AS out_on_lend,
       count(*) FILTER (WHERE m.listing_type = 'sell')        AS sell_listings,
       coalesce(sum(m.price) FILTER (WHERE m.listing_type = 'sell' AND m.status = 'active'), 0) AS inventory_value,
       coalesce(round(avg(m.price) FILTER (WHERE m.listing_type = 'sell'), 2), 0)               AS avg_price,
       coalesce(max(m.price), 0)                              AS max_price,
       coalesce(round(avg(m.rating_avg), 2), 0)               AS avg_rating,
       count(DISTINCT m.owner_id)                             AS distinct_owners,
       max(m.updated_at)                                      AS last_change
FROM resource_mirror m
WHERE m.status = 'active'
GROUP BY m.department, m.category;
CREATE UNIQUE INDEX mv_campus_activity_key ON mv_campus_activity (department, category);

CREATE OR REPLACE FUNCTION cx_refresh_analytics()
RETURNS timestamptz
LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_campus_activity;
  RETURN now();
END $$;

-- --- KPI block (single jsonb payload consumed by the admin dashboard) ------
CREATE OR REPLACE FUNCTION cx_analytics_overview()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'listings',            (SELECT count(*) FROM resource_mirror WHERE status = 'active'),
    'availableListings',   (SELECT count(*) FROM resource_mirror WHERE status = 'active' AND availability = 'available'),
    'inventoryValue',      (SELECT coalesce(sum(price), 0) FROM resource_mirror WHERE status = 'active' AND listing_type = 'sell'),
    'avgPrice',            (SELECT coalesce(round(avg(price), 2), 0) FROM resource_mirror WHERE status = 'active' AND listing_type = 'sell'),
    'versionsRecorded',    (SELECT count(*) FROM resource_version),
    'resourcesVersioned',  (SELECT count(DISTINCT resource_id) FROM resource_version),
    'avgVersionsPerItem',  (SELECT coalesce(round(count(*)::numeric / greatest(count(DISTINCT resource_id), 1), 2), 0) FROM resource_version),
    'lendsOut',            (SELECT count(*) FROM lend_period WHERE status = 'out'),
    'lendsOverdue',        (SELECT count(*) FROM lend_period WHERE status = 'overdue'),
    'lendsClosed',         (SELECT count(*) FROM lend_period WHERE status = 'returned'),
    'avgHeldDays',         (SELECT coalesce(round(avg(EXTRACT(epoch FROM (coalesce(upper(scope), now()) - lower(scope))) / 86400), 2), 0) FROM lend_period),
    'eventsFired',         (SELECT count(*) FROM active_event),
    'eventsPending',       (SELECT count(*) FROM active_event WHERE delivery_status = 'pending'),
    'rulesArmed',          (SELECT count(*) FROM active_rule WHERE enabled),
    'campusZones',         (SELECT count(*) FROM campus_zone),
    'geoTaggedResources',  (SELECT count(*) FROM geo_resource),
    'geoTaggedStudents',   (SELECT count(*) FROM geo_user),
    'spatialProvider',     cx_spatial_provider(),
    'indexedDocuments',    (SELECT count(*) FROM search_doc),
    'watchList',           (SELECT count(*) FROM resource_watch WHERE status = 'open'),
    'generatedAt',         now()
  );
$$;

-- --- Daily trend via generate_series (days without activity become 0) ------
CREATE OR REPLACE FUNCTION cx_listing_trend(p_days integer DEFAULT 14)
RETURNS TABLE (
  day date, new_versions bigint, price_changes bigint, cumulative_listings bigint
)
LANGUAGE sql STABLE AS $$
  WITH days AS (
    SELECT generate_series(
             (now() - make_interval(days => greatest(p_days, 1)))::date,
             now()::date,
             interval '1 day'
           )::date AS day
  )
  SELECT d.day,
         coalesce(v.new_versions, 0),
         coalesce(v.price_changes, 0),
         (SELECT count(*) FROM resource_mirror m WHERE m.created_at::date <= d.day)::bigint
  FROM days d
  LEFT JOIN (
    SELECT valid_from::date AS day,
           count(*)                                          AS new_versions,
           count(*) FILTER (WHERE 'price' = ANY(changed_fields)) AS price_changes
    FROM resource_version
    GROUP BY valid_from::date
  ) v ON v.day = d.day
  ORDER BY d.day;
$$;
-- --- Top lenders (window functions: RANK + running total) ------------------
CREATE OR REPLACE FUNCTION cx_top_lenders(p_limit integer DEFAULT 10)
RETURNS TABLE (
  owner_id text, owner_label text, lends bigint, returned bigint, overdue bigint,
  avg_held_days numeric, rank integer, running_total bigint
)
LANGUAGE sql STABLE AS $$
  SELECT owner_id,
         max(owner_label)                                              AS owner_label,
         count(*)                                                      AS lends,
         count(*) FILTER (WHERE status = 'returned')                    AS returned,
         count(*) FILTER (WHERE status = 'overdue')                     AS overdue,
         coalesce(round(avg(EXTRACT(epoch FROM (coalesce(upper(scope), now()) - lower(scope))) / 86400), 2), 0) AS avg_held_days,
         rank() OVER (ORDER BY count(*) DESC)::int                      AS rank,
         sum(count(*)) OVER (ORDER BY count(*) DESC, owner_id)::bigint   AS running_total
  FROM (
    SELECT l.owner_id,
           l.status,
           l.scope,
           coalesce(m.owner_label, l.owner_id) AS owner_label
    FROM lend_period l
    LEFT JOIN resource_mirror m ON m.resource_id = l.resource_id
  ) t
  GROUP BY owner_id
  ORDER BY lends DESC, owner_id
  LIMIT greatest(p_limit, 1);
$$;

-- --- Price statistics per category (percentiles + spread) ------------------
CREATE OR REPLACE FUNCTION cx_price_stats()
RETURNS TABLE (
  category text, listings bigint, min_price numeric, median_price numeric,
  avg_price numeric, max_price numeric, stddev_price numeric, p90 numeric
)
LANGUAGE sql STABLE AS $$
  SELECT category,
         count(*)                                                          AS listings,
         min(price)                                                        AS min_price,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::numeric(10,2)  AS median_price,
         round(avg(price), 2)                                              AS avg_price,
         max(price)                                                        AS max_price,
         round(stddev_samp(price), 2)                                      AS stddev_price,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY price)::numeric(10,2)  AS p90
  FROM resource_mirror
  WHERE status = 'active' AND listing_type = 'sell' AND price > 0
  GROUP BY category
  ORDER BY listings DESC;
$$;

-- --- Price bands via width_bucket (histogram) -----------------------------
CREATE OR REPLACE FUNCTION cx_price_bands(p_buckets integer DEFAULT 5)
RETURNS TABLE (band integer, from_price numeric, to_price numeric, listings bigint)
LANGUAGE sql STABLE AS $$
  WITH bounds AS (
    SELECT min(price) AS lo, max(price) AS hi
      FROM resource_mirror
     WHERE status = 'active' AND listing_type = 'sell' AND price > 0
  ),
  banded AS (
    SELECT width_bucket(m.price, b.lo, b.hi + 1, greatest(p_buckets, 1)) AS band,
           b.lo,
           b.hi
    FROM resource_mirror m, bounds b
    WHERE m.status = 'active' AND m.listing_type = 'sell' AND m.price > 0
  )
  SELECT band,
         min(lo + (band - 1) * ((hi + 1 - lo) / greatest(p_buckets, 1)))::numeric(10,2) AS from_price,
         min(lo + band * ((hi + 1 - lo) / greatest(p_buckets, 1)))::numeric(10,2)       AS to_price,
         count(*)                                                                        AS listings
  FROM banded
  GROUP BY band
  ORDER BY band;
$$;

-- --- Most "eventful" listings (join across the temporal + active layers) ---
CREATE OR REPLACE FUNCTION cx_most_changed_resources(p_limit integer DEFAULT 10)
RETURNS TABLE (
  resource_id text, title text, versions bigint, price_drops bigint,
  events bigint, last_change timestamptz, volatility numeric
)
LANGUAGE sql STABLE AS $$
  SELECT m.resource_id,
         m.title,
         count(DISTINCT v.version_id)                                  AS versions,
         count(DISTINCT v.version_id) FILTER (WHERE 'price' = ANY(v.changed_fields)) AS price_drops,
         count(DISTINCT e.event_id)                                    AS events,
         max(v.valid_from)                                             AS last_change,
         round(count(DISTINCT v.version_id)::numeric
               / greatest(EXTRACT(epoch FROM (now() - min(v.valid_from))) / 86400, 1), 3) AS volatility
  FROM resource_mirror m
  LEFT JOIN resource_version v ON v.resource_id = m.resource_id
  LEFT JOIN active_event e ON e.entity_id = m.resource_id AND e.entity_type = 'resource'
  WHERE m.status = 'active'
  GROUP BY m.resource_id, m.title
  HAVING count(DISTINCT v.version_id) > 1
  ORDER BY versions DESC, events DESC
  LIMIT greatest(p_limit, 1);
$$;

-- ============================================================================
-- INTROSPECTION — the admin monitor reads PostgreSQL's own catalog.
-- (Metadata, not user data: the reason SQL databases are so observable.)
-- ============================================================================
CREATE OR REPLACE FUNCTION cx_table_stats()
RETURNS TABLE (
  table_name text, live_rows bigint, size_bytes bigint, size_pretty text,
  seq_scans bigint, index_scans bigint, inserts bigint, updates bigint, deletes bigint
)
LANGUAGE sql STABLE AS $$
  SELECT s.relname::text,
         coalesce(s.n_live_tup, 0)::bigint,
         pg_total_relation_size(c.oid)::bigint,
         pg_size_pretty(pg_total_relation_size(c.oid)),
         s.seq_scan, s.idx_scan, s.n_tup_ins, s.n_tup_upd, s.n_tup_del
  FROM pg_stat_user_tables s
  JOIN pg_class c ON c.oid = s.relid
  WHERE s.schemaname = 'public'
  ORDER BY pg_total_relation_size(c.oid) DESC;
$$;

CREATE OR REPLACE FUNCTION cx_trigger_catalog()
RETURNS TABLE (
  trigger_name text, table_name text, function_name text, timing text,
  event text, enabled text
)
LANGUAGE sql STABLE AS $$
  SELECT t.tgname::text,
         c.relname::text,
         p.proname::text,
         CASE WHEN (t.tgtype & 2) = 2 THEN 'BEFORE'
              WHEN (t.tgtype & 64) = 64 THEN 'INSTEAD OF'
              ELSE 'AFTER' END,
         trim(both ' OR ' FROM concat_ws(' OR ',
           CASE WHEN (t.tgtype & 4) = 4 THEN 'INSERT' END,
           CASE WHEN (t.tgtype & 8) = 8 THEN 'DELETE' END,
           CASE WHEN (t.tgtype & 16) = 16 THEN 'UPDATE' END,
           CASE WHEN (t.tgtype & 32) = 32 THEN 'TRUNCATE' END)),
         CASE t.tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'disabled' ELSE t.tgenabled::text END
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
  ORDER BY c.relname, t.tgname;
$$;

CREATE OR REPLACE FUNCTION cx_index_usage()
RETURNS TABLE (index_name text, table_name text, scans bigint, size_pretty text)
LANGUAGE sql STABLE AS $$
  SELECT s.indexrelname::text,
         s.relname::text,
         s.idx_scan,
         pg_size_pretty(pg_relation_size(s.indexrelid))
  FROM pg_stat_user_indexes s
  WHERE s.schemaname = 'public'
  ORDER BY s.idx_scan DESC, s.indexrelname;
$$;

CREATE OR REPLACE FUNCTION cx_pg_internals()
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'version',           current_setting('server_version'),
    'database',          current_database(),
    'spatialProvider',   cx_spatial_provider(),
    'databaseSize',      pg_size_pretty(pg_database_size(current_database())),
    'databaseSizeBytes', pg_database_size(current_database()),
    'connections',       (SELECT numbackends FROM pg_stat_database WHERE datname = current_database()),
    'xactCommit',        (SELECT xact_commit FROM pg_stat_database WHERE datname = current_database()),
    'xactRollback',      (SELECT xact_rollback FROM pg_stat_database WHERE datname = current_database()),
    'tuplesReturned',    (SELECT tup_returned FROM pg_stat_database WHERE datname = current_database()),
    'cacheHitRatio',     (SELECT round(100.0 * blks_hit / greatest(blks_hit + blks_read, 1), 2)
                            FROM pg_stat_database WHERE datname = current_database()),
    'deadlocks',         (SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()),
    'tables',            (SELECT count(*) FROM pg_stat_user_tables WHERE schemaname = 'public'),
    'views',             (SELECT count(*) FROM pg_views WHERE schemaname = 'public'),
    'materializedViews', (SELECT count(*) FROM pg_matviews WHERE schemaname = 'public'),
    'functions',         (SELECT count(*) FROM pg_proc p
                            JOIN pg_namespace n ON n.oid = p.pronamespace
                           WHERE n.nspname = 'public' AND p.proname LIKE 'cx\_%'),
    'triggers',          (SELECT count(*) FROM cx_trigger_catalog()),
    'indexes',           (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'),
    'extensions',        (SELECT jsonb_agg(jsonb_build_object('name', e.extname, 'version', e.extversion)
                                           ORDER BY e.extname)
                            FROM pg_extension e),
    'constraints',       (SELECT jsonb_agg(jsonb_build_object('name', conname, 'type', contype)
                                           ORDER BY conname)
                            FROM pg_constraint
                           WHERE connamespace = 'public'::regnamespace
                             AND contype IN ('x', 'p', 'f', 'u')),
    'uptime',            (now() - pg_postmaster_start_time())::text,
    'readAt',            now()
  );
$$;


-- CX_CONTINUE
