-- ============================================================================
-- CampusXchange · PostgreSQL layer · migration 002 — TEMPORAL tables
-- ----------------------------------------------------------------------------
-- SQL:2011 style application-time period tables implemented by hand:
--
--   resource_version : one row per state of a resource
--                      valid_from / valid_to      → VALID time (business time)
--                      recorded_at / system_to    → SYSTEM time (transaction time)
--                      ⇒ bi-temporal, because both axes are stored.
--
--   lend_period      : borrow cycles as a tstzrange period.
--
-- Two DECLARATIVE integrity guarantees the application can never bypass:
--   * EXCLUDE (resource_id =, tstzrange &&)  → valid-time intervals per resource
--     can never overlap (no two "truths" at the same instant).
--   * EXCLUDE (resource_id =, scope &&) WHERE status <> 'cancelled'
--     → the same item can never be lent to two students at once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS resource_version (
  version_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_id    text NOT NULL REFERENCES resource_mirror(resource_id) ON DELETE CASCADE,
  version_no     integer NOT NULL,
  -- VALID time (when the state was true in the real world)
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_to       timestamptz,
  -- SYSTEM time (when the database learned / stopped believing it)
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  system_to      timestamptz,
  price          numeric(10, 2) NOT NULL DEFAULT 0,
  condition      text NOT NULL DEFAULT 'good',
  availability   text NOT NULL DEFAULT 'available',
  listing_type   text NOT NULL DEFAULT 'sell',
  owner_id       text NOT NULL,
  owner_label    text NOT NULL DEFAULT '',
  title          text NOT NULL DEFAULT '',
  changed_fields text[] NOT NULL DEFAULT '{}',
  change_note    text NOT NULL DEFAULT '',
  written_by     text NOT NULL DEFAULT 'user',
  CONSTRAINT resource_version_period_valid CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT resource_version_system_valid CHECK (system_to IS NULL OR system_to >= recorded_at),
  CONSTRAINT resource_version_no_valid_overlap EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(valid_from, valid_to, '[)') WITH &&
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS resource_version_no_idx ON resource_version (resource_id, version_no);
CREATE INDEX IF NOT EXISTS resource_version_current_idx ON resource_version (resource_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS resource_version_valid_idx ON resource_version (valid_from DESC);

COMMENT ON TABLE resource_version IS
  'TEMPORAL: bi-temporal history of a resource (valid time + system time), maintained by trigger cx_trg_resource_version.';

-- --- Borrow cycles as periods ----------------------------------------------
CREATE TABLE IF NOT EXISTS lend_period (
  lend_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_id    text NOT NULL,
  transaction_id text,
  owner_id       text NOT NULL,
  borrower_id    text NOT NULL,
  scope          tstzrange NOT NULL,               -- [lent_at, returned_at)
  due_at         timestamptz,
  returned_at    timestamptz,
  status         text NOT NULL DEFAULT 'out'
                 CHECK (status IN ('out', 'returned', 'overdue', 'cancelled')),
  note           text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lend_period_scope_valid CHECK (upper(scope) IS NULL OR upper(scope) > lower(scope)),
  CONSTRAINT lend_period_no_double_lend EXCLUDE USING gist (resource_id WITH =, scope WITH &&)
    WHERE (status <> 'cancelled')
);

CREATE INDEX IF NOT EXISTS lend_period_open_idx ON lend_period (status, due_at) WHERE status IN ('out', 'overdue');
CREATE INDEX IF NOT EXISTS lend_period_borrower_idx ON lend_period (borrower_id, status);

COMMENT ON TABLE lend_period IS
  'TEMPORAL: borrow cycles as tstzrange periods; an EXCLUDE constraint makes double-lending impossible.';
-- ============================================================================
-- TEMPORAL views — the "history / lifecycle" requirement, expressed in SQL
-- ============================================================================

-- Current state = the row whose valid-time interval is still open.
CREATE OR REPLACE VIEW v_resource_current AS
SELECT m.resource_id,
       m.title,
       m.category,
       m.subject,
       m.department,
       m.semester,
       v.version_no,
       v.price,
       v.condition,
       v.availability,
       v.listing_type,
       v.owner_id,
       v.owner_label,
       v.valid_from            AS state_since,
       (now() - v.valid_from)  AS state_age,
       v.recorded_at           AS state_recorded_at
FROM resource_mirror m
JOIN resource_version v
  ON v.resource_id = m.resource_id AND v.valid_to IS NULL
WHERE m.status = 'active';

-- Every price movement, computed with a window function (LAG).
CREATE OR REPLACE VIEW v_resource_price_history AS
SELECT resource_id,
       version_no,
       valid_from,
       valid_to,
       price,
       LAG(price) OVER w                                   AS previous_price,
       price - LAG(price) OVER w                           AS delta,
       round(100 * (price - LAG(price) OVER w)
             / NULLIF(LAG(price) OVER w, 0), 2)            AS pct_change,
       change_note,
       written_by
FROM resource_version
WINDOW w AS (PARTITION BY resource_id ORDER BY version_no)
ORDER BY resource_id, version_no;

-- Borrow cycles with SQL date arithmetic + overdue severity.
CREATE OR REPLACE VIEW v_lend_activity AS
SELECT l.lend_id,
       l.resource_id,
       m.title                AS resource_title,
       l.owner_id,
       l.borrower_id,
       l.status,
       lower(l.scope)         AS lent_at,
       upper(l.scope)         AS ended_at,
       l.due_at,
       l.returned_at,
       (now() - l.due_at)                                    AS time_past_due,
       CASE WHEN l.status = 'overdue'
            THEN floor(EXTRACT(epoch FROM (now() - l.due_at)) / 86400)::int
            ELSE 0 END                                       AS days_overdue,
       EXTRACT(epoch FROM (coalesce(upper(l.scope), now()) - lower(l.scope))) / 86400 AS held_days
FROM lend_period l
LEFT JOIN resource_mirror m ON m.resource_id = l.resource_id
ORDER BY l.status, l.due_at NULLS LAST;

-- ============================================================================
-- TEMPORAL functions
-- ============================================================================

-- "What did this listing look like at that moment?" — the classic as-of query.
-- WHERE valid_from <= ts AND (valid_to > ts OR valid_to IS NULL)
CREATE OR REPLACE FUNCTION cx_resource_as_of(p_resource_id text, p_at timestamptz)
RETURNS TABLE (
  resource_id  text,
  version_no   integer,
  title        text,
  price        numeric,
  condition    text,
  availability text,
  listing_type text,
  owner_id     text,
  owner_label  text,
  valid_from   timestamptz,
  valid_to     timestamptz,
  recorded_at  timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT v.resource_id, v.version_no, v.title, v.price, v.condition, v.availability,
         v.listing_type, v.owner_id, v.owner_label, v.valid_from, v.valid_to, v.recorded_at
  FROM resource_version v
  WHERE v.resource_id = p_resource_id
    AND v.valid_from <= p_at
    AND (v.valid_to IS NULL OR v.valid_to > p_at)
  LIMIT 1;
$$;

-- Price trajectory for a resource (window-function based deltas).
CREATE OR REPLACE FUNCTION cx_price_trajectory(p_resource_id text)
RETURNS TABLE (
  version_no   integer,
  valid_from   timestamptz,
  valid_to     timestamptz,
  price        numeric,
  previous_price numeric,
  pct_change   numeric,
  change_note  text
)
LANGUAGE sql STABLE AS $$
  SELECT version_no, valid_from, valid_to, price, previous_price, pct_change, change_note
  FROM v_resource_price_history
  WHERE resource_id = p_resource_id
  ORDER BY version_no;
$$;

-- Integrity audit: proves the EXCLUDE constraint held (0 overlaps) and finds
-- any hole in the valid-time coverage of a resource. Viva-ready evidence.
CREATE OR REPLACE FUNCTION cx_temporal_integrity(p_resource_id text DEFAULT NULL)
RETURNS TABLE (
  resource_id   text,
  versions      integer,
  open_versions integer,
  overlap_count integer,
  gap_count     integer,
  first_valid   timestamptz,
  last_valid    timestamptz,
  span_days     numeric
)
LANGUAGE sql STABLE AS $$
  WITH ordered AS (
    SELECT resource_id,
           version_no,
           valid_from,
           valid_to,
           LEAD(valid_from) OVER (PARTITION BY resource_id ORDER BY version_no) AS next_valid_from
    FROM resource_version
    WHERE p_resource_id IS NULL OR resource_id = p_resource_id
  )
  SELECT resource_id,
         count(*)::int                                                    AS versions,
         count(*) FILTER (WHERE valid_to IS NULL)::int                     AS open_versions,
         count(*) FILTER (WHERE next_valid_from IS NOT NULL
                            AND valid_to IS NOT NULL
                            AND next_valid_from < valid_to)::int           AS overlap_count,
         count(*) FILTER (WHERE next_valid_from IS NOT NULL
                            AND (valid_to IS NULL OR next_valid_from > valid_to))::int AS gap_count,
         min(valid_from)                                                   AS first_valid,
         max(valid_from)                                                   AS last_valid,
         round(EXTRACT(epoch FROM (max(coalesce(valid_to, now())) - min(valid_from))) / 86400, 2) AS span_days
  FROM ordered
  GROUP BY resource_id
  ORDER BY resource_id;
$$;

