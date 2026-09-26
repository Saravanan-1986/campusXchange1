-- CampusXchange PostgreSQL smoke test (run by npm run db:smoke)
\set ON_ERROR_STOP on
BEGIN;

-- 0) zones ------------------------------------------------------------------
INSERT INTO campus_zone (zone_id, name, kind, lat, lon, capacity) VALUES
  ('lib-main', 'Central Library', 'library', 12.9716, 77.5946, 400)
ON CONFLICT (zone_id) DO NOTHING;
INSERT INTO campus_zone (zone_id, name, kind, lat, lon, capacity) VALUES
  ('canteen', 'Main Canteen', 'canteen', 12.9735, 77.5960, 250)
ON CONFLICT (zone_id) DO NOTHING;

-- 1) TEMPORAL: an INSERT must auto-create version 1 (trigger)
INSERT INTO resource_mirror (resource_id, title, category, subject, department, semester,
                             condition, listing_type, price, availability, owner_id, owner_label)
VALUES ('smoke11111111111111111111', 'Smoke Test Textbook', 'textbook', 'DBMS', 'Computer Science', 5,
        'good', 'sell', 500, 'available', 'owner-1', 'A*** S***');

SELECT 'v1 versions' AS check, count(*) AS n FROM resource_version
 WHERE resource_id = 'smoke11111111111111111111';

-- 2) ACTIVE: a price change must version + emit an event + bump the rule
UPDATE resource_mirror SET price = 400 WHERE resource_id = 'smoke11111111111111111111';

SELECT 'v1 closed' AS check, valid_to IS NOT NULL AS closed FROM resource_version
 WHERE resource_id = 'smoke11111111111111111111' AND version_no = 1;
SELECT 'v2 open' AS check, valid_to IS NULL AS open, price FROM resource_version
 WHERE resource_id = 'smoke11111111111111111111' AND version_no = 2;
SELECT 'events' AS check, rule_id, severity, title FROM active_event
 WHERE entity_id = 'smoke11111111111111111111' ORDER BY event_id;
SELECT 'rule fired' AS check, rule_id, fire_count FROM active_rule
 WHERE rule_id = 'price-change-alert';

-- 3) SPATIAL: the zone trigger snaps the point to the nearest campus zone
INSERT INTO geo_resource (resource_id, owner_id, lat, lon, label)
VALUES ('smoke11111111111111111111', 'owner-1', 12.9717, 77.5947, 'Library steps');
SELECT 'zone snapped' AS check, zone_id FROM geo_resource
 WHERE resource_id = 'smoke11111111111111111111';

SELECT 'nearby distance_m' AS check, resource_id, zone_name, distance_m
  FROM cx_nearby_resources(12.9716, 77.5946, 2000, true) LIMIT 3;

-- 4) TEMPORAL: as-of query time travel (v1 price vs current price)
SELECT 'as-of v1 price' AS check, price AS price_at_v1
  FROM cx_resource_as_of('smoke11111111111111111111',
                         (SELECT valid_from + interval '1 microsecond' FROM resource_version
                           WHERE resource_id = 'smoke11111111111111111111' AND version_no = 1));
SELECT 'as-of now' AS check, price AS price_now
  FROM cx_resource_as_of('smoke11111111111111111111', clock_timestamp());

-- 5) TEMPORAL: the EXCLUDE constraint must reject a double lend
INSERT INTO lend_period (resource_id, transaction_id, owner_id, borrower_id, scope, due_at, status)
VALUES ('smoke11111111111111111111', 'tx-1', 'owner-1', 'borrower-1',
        tstzrange(clock_timestamp() - interval '2 days', NULL), clock_timestamp() + interval '5 days', 'out');

DO $$
BEGIN
  INSERT INTO lend_period (resource_id, transaction_id, owner_id, borrower_id, scope, due_at, status)
  VALUES ('smoke11111111111111111111', 'tx-2', 'owner-1', 'borrower-2',
          tstzrange(clock_timestamp() - interval '1 day', NULL), clock_timestamp() + interval '3 days', 'out');
  RAISE EXCEPTION 'FAIL: double-lend was accepted';
EXCEPTION WHEN exclusion_violation THEN
  RAISE NOTICE 'PASS: double-lend blocked by EXCLUDE constraint';
END $$;

-- 6) ACTIVE: closing the lend emits the return event; a second item goes overdue
UPDATE lend_period SET scope = tstzrange(lower(scope), clock_timestamp()),
                       status = 'returned', returned_at = clock_timestamp()
 WHERE resource_id = 'smoke11111111111111111111';

INSERT INTO resource_mirror (resource_id, title, category, subject, department, semester,
                             condition, listing_type, price, availability, owner_id, owner_label)
VALUES ('smoke22222222222222222222', 'Overdue Drill Kit', 'lab-kit', 'Workshop', 'Electronics', 4,
        'good', 'lend', 0, 'lent', 'owner-1', 'A*** S***');

INSERT INTO lend_period (resource_id, transaction_id, owner_id, borrower_id, scope, due_at, status)
VALUES ('smoke22222222222222222222', 'tx-3', 'owner-1', 'borrower-3',
        tstzrange(clock_timestamp() - interval '10 days', NULL), clock_timestamp() - interval '3 days', 'out');

SELECT 'overdue flagged' AS check, cx_check_overdue_lends(interval '0 seconds') AS rows_changed;
SELECT 'lend events' AS check, event_type, severity FROM active_event
 WHERE entity_type = 'lend' ORDER BY event_id;


-- 7) ANALYTICS + OUTBOX
SELECT 'analytics' AS check, cx_analytics_overview() - 'generatedAt' AS kpis;
SELECT 'outbox drain' AS check, count(*) AS drained FROM cx_active_drain(5);
SELECT 'to_kpis' AS check, cx_analytics_overview() ->> 'eventsPending' AS pending;
SELECT 'internals' AS check, jsonb_pretty(cx_pg_internals() - 'constraints' - 'extensions');

ROLLBACK;   -- smoke test never leaves data behind
