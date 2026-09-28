-- ============================================================================
-- CampusXchange · PostgreSQL layer · migration 006 — CUSTODY / HANDOVER chain
-- ----------------------------------------------------------------------------
-- The marketplace item keeps its identity when it changes hands (donate / sell).
-- Every stretch of time one student owned it is stored as a SQL:2011 style
-- valid-time PERIOD in a tstzrange, which buys us three things plain documents
-- cannot give us:
--
--   * declarative integrity — EXCLUDE (resource_id =, scope &&) makes
--     "one item owned by two students at the same instant" impossible;
--   * a chain query — "who had this product before me?" is a window function
--     (LAG over the ordered periods), not an application loop;
--   * lifetime analytics — held-days per owner with plain date arithmetic.
--
--   custody_period : one row per owner-custody period
--                    [held_from, handed_over_at)   valid time
--                    handed_to_id / kind / note    how it changed hands
--
-- The chain is maintained by a TRIGGER on resource_mirror, so a handover can
-- never be forgotten by application code (and the EXCLUDE constraint proves it).
-- ============================================================================

-- The mirror learns one new column: is the item currently on the marketplace?
ALTER TABLE resource_mirror ADD COLUMN IF NOT EXISTS is_listed boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS resource_mirror_listed_idx
  ON resource_mirror (is_listed, availability) WHERE status = 'active';

-- --- Custody periods --------------------------------------------------------
CREATE TABLE IF NOT EXISTS custody_period (
  custody_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_id   text NOT NULL,
  owner_id      text NOT NULL,
  owner_label   text NOT NULL DEFAULT '',
  -- how this custody started: listed on the market, taken by sold/donated,
  -- re-listed by its new owner, or pulled off the market by its owner.
  kind          text NOT NULL DEFAULT 'listed'
                CHECK (kind IN ('listed', 'sold', 'donated', 'received', 'relisted', 'unlisted')),
  handover_note text NOT NULL DEFAULT '',
  scope         tstzrange NOT NULL,       -- [held_from, handed_over_at)
  handed_to_id  text,                     -- receiver (NULL while still held)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custody_scope_valid CHECK (upper(scope) IS NULL OR upper(scope) > lower(scope)),
  -- DECLARATIVE INTEGRITY: an item can never be owned by two students at once.
  CONSTRAINT custody_no_double_owner EXCLUDE USING gist (resource_id WITH =, scope WITH &&)
);

CREATE INDEX IF NOT EXISTS custody_open_idx  ON custody_period (resource_id) WHERE upper(scope) IS NULL;
CREATE INDEX IF NOT EXISTS custody_owner_idx ON custody_period (owner_id, scope DESC);
CREATE INDEX IF NOT EXISTS custody_chain_idx ON custody_period (resource_id, scope);

COMMENT ON TABLE custody_period IS
  'TEMPORAL: ownership chain of a marketplace item as valid-time periods; EXCLUDE keeps double ownership impossible.';
COMMENT ON COLUMN custody_period.scope IS
  'Valid-time period [held_from, handed_over_at) — NULL upper bound means "still held".';

-- ============================================================================
-- TRIGGER — chain the custody automatically on every owner change
-- ============================================================================
CREATE OR REPLACE FUNCTION cx_trg_custody_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_now  timestamptz := clock_timestamp();
  v_open custody_period%ROWTYPE;
  v_kind text;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id THEN
    RETURN NULL;                                  -- nothing changed hands
  END IF;

  SELECT * INTO v_open
    FROM custody_period
   WHERE resource_id = NEW.resource_id AND upper(scope) IS NULL
   ORDER BY lower(scope) DESC
   LIMIT 1;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO custody_period (resource_id, owner_id, owner_label, kind, handover_note, scope)
    VALUES (NEW.resource_id, NEW.owner_id, NEW.owner_label, 'listed',
            'Listed on the marketplace', tstzrange(v_now, NULL, '[)'));
    RETURN NULL;
  END IF;

  -- A handover: close the previous period exactly where the new one begins so
  -- the intervals stay adjacent ([) bounds) and the EXCLUDE never fires.
  IF v_open.custody_id IS NOT NULL THEN
    UPDATE custody_period
       SET scope        = tstzrange(lower(scope), v_now, '[)'),
           handed_to_id = NEW.owner_id,
           updated_at   = v_now
     WHERE custody_id = v_open.custody_id;
  END IF;

  -- price > 0 ⇒ it was sold, otherwise it was donated.
  v_kind := CASE WHEN coalesce(NEW.price, 0) > 0 THEN 'sold' ELSE 'donated' END;

  INSERT INTO custody_period (resource_id, owner_id, owner_label, kind, handover_note, scope)
  VALUES (NEW.resource_id, NEW.owner_id, NEW.owner_label, v_kind,
          format('received from %s (%s)', nullif(OLD.owner_label, ''), v_kind),
          tstzrange(v_now, NULL, '[)'));

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_custody_sync_t ON resource_mirror;
CREATE TRIGGER trg_custody_sync_t
  AFTER INSERT OR UPDATE ON resource_mirror
  FOR EACH ROW EXECUTE FUNCTION cx_trg_custody_sync();


-- ============================================================================
-- Tag the custody row the trigger just opened (the app knows whether the
-- handover came from a chat /donate, /sell, or a plain "remove from market").
-- ============================================================================
CREATE OR REPLACE FUNCTION cx_tag_custody(p_resource_id text, p_kind text DEFAULT NULL, p_note text DEFAULT '')
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_id bigint;
BEGIN
  UPDATE custody_period
     SET kind          = coalesce(p_kind, kind),
         handover_note = coalesce(nullif(p_note, ''), handover_note),
         updated_at    = now()
   WHERE resource_id = p_resource_id AND upper(scope) IS NULL
  RETURNING custody_id INTO v_id;
  RETURN v_id;
END $$;

COMMENT ON FUNCTION cx_tag_custody(text, text, text) IS
  'Annotates the currently open custody period (kind = sold/donated/relisted/unlisted + note).';

-- ============================================================================
-- THE CHAIN — "who owned this product before me?" in one SQL statement
-- ============================================================================
CREATE OR REPLACE FUNCTION cx_custody_chain(p_resource_id text)
RETURNS TABLE (
  custody_id           bigint,
  chain_position       integer,
  owner_id             text,
  owner_label          text,
  kind                 text,
  held_from            timestamptz,
  handed_over_at       timestamptz,
  held_days            numeric,
  is_current           boolean,
  previous_owner_label text,
  handed_to_id         text,
  handover_note        text
)
LANGUAGE sql STABLE AS $$
  SELECT c.custody_id,
         row_number() OVER w                          AS chain_position,
         c.owner_id,
         c.owner_label,
         c.kind,
         lower(c.scope)                               AS held_from,
         upper(c.scope)                               AS handed_over_at,
         round(EXTRACT(epoch FROM (coalesce(upper(c.scope), now()) - lower(c.scope))) / 86400, 2) AS held_days,
         upper(c.scope) IS NULL                       AS is_current,
         LAG(c.owner_label) OVER w                    AS previous_owner_label,
         c.handed_to_id,
         c.handover_note
    FROM custody_period c
   WHERE c.resource_id = p_resource_id
  WINDOW w AS (ORDER BY lower(c.scope))
   ORDER BY lower(c.scope);
$$;

COMMENT ON FUNCTION cx_custody_chain(text) IS
  'TEMPORAL: full ownership chain of one item (previous users of the product) with held-days per custodian.';

-- All chains in one view (admin / analytics surface).
CREATE OR REPLACE VIEW v_resource_custody AS
SELECT c.resource_id,
       m.title,
       c.custody_id,
       c.owner_id,
       c.owner_label,
       c.kind,
       lower(c.scope)                                       AS held_from,
       upper(c.scope)                                       AS handed_over_at,
       c.handed_to_id,
       c.handover_note,
       upper(c.scope) IS NULL                               AS is_current,
       LAG(c.owner_label) OVER (PARTITION BY c.resource_id ORDER BY lower(c.scope)) AS previous_owner_label,
       round(EXTRACT(epoch FROM (coalesce(upper(c.scope), now()) - lower(c.scope))) / 86400, 2) AS held_days
FROM custody_period c
LEFT JOIN resource_mirror m ON m.resource_id = c.resource_id;

-- Chain audit: handovers counted + overlap/gap proof for the viva.
CREATE OR REPLACE FUNCTION cx_custody_integrity(p_resource_id text DEFAULT NULL)
RETURNS TABLE (
  resource_id    text,
  custodians     integer,
  handovers      integer,
  overlap_count  integer,
  gap_count      integer,
  first_held     timestamptz,
  last_held      timestamptz,
  total_days     numeric
)
LANGUAGE sql STABLE AS $$
  WITH ordered AS (
    SELECT resource_id, scope, lower(scope) AS held_from, upper(scope) AS handed_over_at,
           LEAD(lower(scope)) OVER (PARTITION BY resource_id ORDER BY lower(scope)) AS next_held
      FROM custody_period
     WHERE p_resource_id IS NULL OR resource_id = p_resource_id
  )
  SELECT resource_id,
         count(*)::int                                                       AS custodians,
         count(*) FILTER (WHERE next_held IS NOT NULL)::int                   AS handovers,
         count(*) FILTER (WHERE next_held IS NOT NULL AND handed_over_at IS NOT NULL
                            AND next_held < handed_over_at)::int              AS overlap_count,
         count(*) FILTER (WHERE next_held IS NOT NULL
                            AND (handed_over_at IS NULL OR next_held > handed_over_at))::int AS gap_count,
         min(held_from)                                                       AS first_held,
         max(coalesce(handed_over_at, now()))                                 AS last_held,
         round(EXTRACT(epoch FROM (max(coalesce(handed_over_at, now())) - min(held_from))) / 86400, 2) AS total_days
    FROM ordered
   GROUP BY resource_id
   ORDER BY custodians DESC;
$$;



-- Recent handovers across the whole campus (dashboard "items moving" feed).
CREATE OR REPLACE FUNCTION cx_recent_handovers(p_limit integer DEFAULT 25, p_user_id text DEFAULT NULL)
RETURNS TABLE (
  custody_id       bigint,
  resource_id      text,
  title            text,
  from_owner_id    text,
  from_owner_label text,
  to_owner_id      text,
  to_owner_label   text,
  kind             text,
  handed_over_at   timestamptz,
  held_days        numeric
)
LANGUAGE sql STABLE AS $$
  WITH chain AS (
    SELECT c.*, m.title,
           LAG(c.owner_id)    OVER (PARTITION BY c.resource_id ORDER BY lower(c.scope)) AS prev_owner_id,
           LAG(c.owner_label) OVER (PARTITION BY c.resource_id ORDER BY lower(c.scope)) AS prev_owner_label,
           row_number()       OVER (PARTITION BY c.resource_id ORDER BY lower(c.scope)) AS rn
      FROM custody_period c
      LEFT JOIN resource_mirror m ON m.resource_id = c.resource_id
  )
  SELECT custody_id, resource_id, title,
         prev_owner_id, coalesce(prev_owner_label, 'unknown'),
         owner_id, owner_label, kind,
         lower(scope) AS handed_over_at,
         round(EXTRACT(epoch FROM (coalesce(upper(scope), now()) - lower(scope))) / 86400, 2) AS held_days
    FROM chain
   WHERE rn > 1
     AND (p_user_id IS NULL OR owner_id = p_user_id OR prev_owner_id = p_user_id)
   ORDER BY lower(scope) DESC
   LIMIT coalesce(p_limit, 25);
$$;

COMMENT ON FUNCTION cx_recent_handovers(integer, text) IS
  'TEMPORAL: recent ownership handovers (optionally filtered to one student), derived from custody_period.';

-- Backfill: every resource that already lives in the mirror gets a custody row
-- so pre-existing listings show a correct (single-owner) chain.
INSERT INTO custody_period (resource_id, owner_id, owner_label, kind, handover_note, scope)
SELECT m.resource_id, m.owner_id, m.owner_label, 'listed',
       'Backfilled from resource_mirror', tstzrange(m.created_at, NULL, '[)')
  FROM resource_mirror m
 WHERE NOT EXISTS (SELECT 1 FROM custody_period c WHERE c.resource_id = m.resource_id);
