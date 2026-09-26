-- ============================================================================
-- CampusXchange · PostgreSQL layer · migration 003 — ACTIVE DATABASE
-- ----------------------------------------------------------------------------
-- This is where PostgreSQL stops being passive storage: PL/pgSQL triggers watch
-- every write, evaluate a CONDITION and perform an ACTION (insert an event into
-- the transactional outbox + pg_notify). The API only *delivers* what the
-- database decided — the ECA loop lives inside the DBMS.
--
--   EVENT      data change   (INSERT/UPDATE/DELETE on a watched table)
--   CONDITION  SQL predicate inside the trigger
--   ACTION     cx_emit() → active_event row + pg_notify('cx_active') + rule counters
-- ============================================================================

-- --- Watch-list mirror (who should be notified for a resource) --------------
CREATE TABLE IF NOT EXISTS resource_watch (
  watch_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_id text NOT NULL,
  user_id     text NOT NULL,
  kind        text NOT NULL DEFAULT 'availability',
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled', 'cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resource_watch_unique UNIQUE (resource_id, user_id, kind)
);
CREATE INDEX IF NOT EXISTS resource_watch_open_idx ON resource_watch (resource_id) WHERE status = 'open';

-- --- cx_emit(): the single ACTION primitive used by every trigger -----------
CREATE OR REPLACE FUNCTION cx_emit(
  p_rule        text,
  p_source      text,
  p_event_type  text,
  p_entity_type text,
  p_entity_id   text,
  p_actor       text,
  p_title       text,
  p_message     text,
  p_link        text,
  p_severity    text,
  p_payload     jsonb   DEFAULT '{}'::jsonb,
  p_recipients  text[]  DEFAULT '{}'
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_id      bigint;
  v_enabled boolean;
BEGIN
  -- CONDITION: a rule switched off in the monitor must not act at all.
  SELECT enabled INTO v_enabled FROM active_rule WHERE rule_id = p_rule;
  IF v_enabled IS FALSE THEN
    RETURN NULL;
  END IF;

  INSERT INTO active_event (rule_id, source, event_type, entity_type, entity_id, actor_id,
                            title, message, link, severity, payload, recipients)
  VALUES (p_rule, p_source, p_event_type, p_entity_type, p_entity_id, p_actor,
          p_title, p_message, p_link, p_severity, p_payload, p_recipients)
  RETURNING event_id INTO v_id;

  UPDATE active_rule
     SET fire_count = fire_count + 1, last_fired_at = now(), updated_at = now()
   WHERE rule_id = p_rule;

  -- Push the notification to every LISTENing API instance (no polling involved).
  PERFORM pg_notify('cx_active', json_build_object(
    'eventId', v_id,
    'rule', p_rule,
    'type', p_event_type,
    'entityId', p_entity_id,
    'severity', p_severity,
    'at', now()
  )::text);

  RETURN v_id;
END $$;

-- ============================================================================
-- TRIGGER 1 — the temporal history writer (valid time + system time)
-- ============================================================================
CREATE OR REPLACE FUNCTION cx_trg_resource_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_fields text[] := '{}';
  v_no     integer;
  v_note   text;
  -- valid_from/valid_to are real-world timestamps: now() is frozen for the whole
  -- transaction, so clock_timestamp() is used to make consecutive intervals
  -- strictly adjacent ([t0,t1) + [t1,∞)) instead of collapsing to zero length.
  v_now timestamptz := clock_timestamp();
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;   -- never re-enter

  IF TG_OP = 'UPDATE' THEN
    IF NEW.title        IS DISTINCT FROM OLD.title        THEN v_fields := array_append(v_fields, 'title');        END IF;
    IF NEW.price        IS DISTINCT FROM OLD.price        THEN v_fields := array_append(v_fields, 'price');        END IF;
    IF NEW.condition    IS DISTINCT FROM OLD.condition    THEN v_fields := array_append(v_fields, 'condition');    END IF;
    IF NEW.availability IS DISTINCT FROM OLD.availability THEN v_fields := array_append(v_fields, 'availability'); END IF;
    IF NEW.listing_type IS DISTINCT FROM OLD.listing_type THEN v_fields := array_append(v_fields, 'listingType');  END IF;
    IF NEW.owner_id     IS DISTINCT FROM OLD.owner_id     THEN v_fields := array_append(v_fields, 'ownerId');      END IF;
    IF NEW.subject      IS DISTINCT FROM OLD.subject      THEN v_fields := array_append(v_fields, 'subject');      END IF;
    IF NEW.department   IS DISTINCT FROM OLD.department   THEN v_fields := array_append(v_fields, 'department');   END IF;
    IF NEW.semester     IS DISTINCT FROM OLD.semester     THEN v_fields := array_append(v_fields, 'semester');     END IF;
    IF NEW.category     IS DISTINCT FROM OLD.category     THEN v_fields := array_append(v_fields, 'category');     END IF;
    IF NEW.status       IS DISTINCT FROM OLD.status       THEN v_fields := array_append(v_fields, 'status');       END IF;
    IF NEW.rating_avg   IS DISTINCT FROM OLD.rating_avg   THEN v_fields := array_append(v_fields, 'ratingAvg');    END IF;

    -- CONDITION: nothing meaningful changed → no new version, no history noise.
    IF v_fields = '{}' THEN RETURN NULL; END IF;
    v_note := 'changed: ' || array_to_string(v_fields, ', ');
  ELSE
    v_note := 'Listed on marketplace';
  END IF;

  -- Close the open VALID-time interval and the open SYSTEM-time interval.
  UPDATE resource_version
     SET valid_to = v_now, system_to = v_now
   WHERE resource_id = NEW.resource_id AND valid_to IS NULL;

  SELECT coalesce(max(version_no), 0) + 1 INTO v_no
    FROM resource_version WHERE resource_id = NEW.resource_id;

  INSERT INTO resource_version (resource_id, version_no, valid_from, valid_to,
                                recorded_at, system_to, price, condition, availability,
                                listing_type, owner_id, owner_label, title,
                                changed_fields, change_note, written_by)
  VALUES (NEW.resource_id, v_no, v_now, NULL,
          v_now, NULL, NEW.price, NEW.condition, NEW.availability,
          NEW.listing_type, NEW.owner_id, NEW.owner_label, NEW.title,
          v_fields, v_note, CASE WHEN TG_OP = 'INSERT' THEN 'trigger:create' ELSE 'trigger:update' END);

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_resource_version_t ON resource_mirror;
CREATE TRIGGER trg_resource_version_t
  AFTER INSERT OR UPDATE ON resource_mirror
  FOR EACH ROW EXECUTE FUNCTION cx_trg_resource_version();
-- ============================================================================
-- TRIGGER 2 — resource ECA events (availability / price / ownership / removal)
-- ============================================================================
CREATE OR REPLACE FUNCTION cx_trg_resource_events() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_watchers text[] := '{}';
  v_ver      integer;
  v_delta    numeric;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM cx_emit('listing-removed', 'trigger', 'resource.removed', 'resource', OLD.resource_id,
      OLD.owner_id, 'Listing removed', format('"%s" was removed from the marketplace.', OLD.title),
      '/resources', 'warning', jsonb_build_object('title', OLD.title), ARRAY[OLD.owner_id]);
    RETURN NULL;
  END IF;

  SELECT coalesce(array_agg(w.user_id), '{}') INTO v_watchers
    FROM resource_watch w WHERE w.resource_id = NEW.resource_id AND w.status = 'open';

  SELECT coalesce(max(version_no), 0) INTO v_ver
    FROM resource_version WHERE resource_id = NEW.resource_id;

  -- CONDITION: availability transitioned into 'available' → alert the watch-list
  IF TG_OP = 'UPDATE' AND NEW.availability IS DISTINCT FROM OLD.availability THEN
    IF NEW.availability = 'available' THEN
      PERFORM cx_emit('notify-on-availability', 'trigger', 'resource.available', 'resource', NEW.resource_id,
        NEW.owner_id, 'Resource back in stock!',
        format('"%s" is available again — %s watcher(s) alerted.',
               NEW.title, coalesce(array_length(v_watchers, 1), 0)),
        '/resources/' || NEW.resource_id, 'success',
        jsonb_build_object('from', OLD.availability, 'to', NEW.availability,
                           'version', v_ver, 'watchers', v_watchers),
        v_watchers);

      UPDATE resource_watch SET status = 'fulfilled'
       WHERE resource_id = NEW.resource_id AND status = 'open';
    ELSE
      PERFORM cx_emit('availability-state-change', 'trigger', 'resource.availability_changed', 'resource', NEW.resource_id,
        NEW.owner_id, format('Listing now %s', NEW.availability),
        format('"%s": %s → %s', NEW.title, OLD.availability, NEW.availability),
        '/resources/' || NEW.resource_id,
        CASE WHEN NEW.availability IN ('flagged', 'unavailable') THEN 'warning' ELSE 'info' END,
        jsonb_build_object('from', OLD.availability, 'to', NEW.availability, 'version', v_ver),
        ARRAY[NEW.owner_id]);
    END IF;
  END IF;

  -- CONDITION: price moved → price-drop alert
  IF TG_OP = 'UPDATE' AND NEW.price IS DISTINCT FROM OLD.price THEN
    v_delta := NEW.price - OLD.price;
    PERFORM cx_emit('price-change-alert', 'trigger', 'resource.price_changed', 'resource', NEW.resource_id,
      NEW.owner_id,
      CASE WHEN v_delta < 0 THEN 'Price dropped 📉' ELSE 'Price updated 📈' END,
      format('"%s": ₹%s → ₹%s (%s%%)', NEW.title, OLD.price, NEW.price,
             coalesce(round(100 * v_delta / NULLIF(OLD.price, 0), 2), 0)),
      '/resources/' || NEW.resource_id,
      CASE WHEN v_delta < 0 THEN 'success' ELSE 'info' END,
      jsonb_build_object('from', OLD.price, 'to', NEW.price, 'delta', v_delta, 'version', v_ver),
      CASE WHEN v_delta < 0 THEN v_watchers ELSE ARRAY[NEW.owner_id] END);
  END IF;

  -- CONDITION: ownership transferred (a sell / donate completed)
  IF TG_OP = 'UPDATE' AND NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    PERFORM cx_emit('ownership-transfer', 'trigger', 'resource.owner_changed', 'resource', NEW.resource_id,
      NEW.owner_id, 'Ownership transferred 🤝',
      format('"%s" moved from %s to %s.', NEW.title, OLD.owner_label, NEW.owner_label),
      '/resources/' || NEW.resource_id, 'success',
      jsonb_build_object('fromOwner', OLD.owner_id, 'toOwner', NEW.owner_id, 'version', v_ver),
      ARRAY[OLD.owner_id, NEW.owner_id]);
  END IF;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_resource_events_t ON resource_mirror;
CREATE TRIGGER trg_resource_events_t
  AFTER INSERT OR UPDATE OR DELETE ON resource_mirror
  FOR EACH ROW EXECUTE FUNCTION cx_trg_resource_events();
-- ============================================================================
-- TRIGGER 3 — borrow-cycle events + the double-lending guard
-- ============================================================================
CREATE OR REPLACE FUNCTION cx_trg_lend_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.due_at IS NOT NULL AND NEW.due_at <= lower(NEW.scope) THEN
      RAISE EXCEPTION 'lend due date (%) must be after the lend start (%)', NEW.due_at, lower(NEW.scope)
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM resource_mirror WHERE resource_id = NEW.resource_id) THEN
      RAISE EXCEPTION 'unknown resource_id % for lend', NEW.resource_id USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  RETURN NEW;   -- BEFORE trigger: the EXCLUDE constraint still re-checks overlaps
END $$;

DROP TRIGGER IF EXISTS trg_lend_guard_t ON lend_period;
CREATE TRIGGER trg_lend_guard_t
  BEFORE INSERT OR UPDATE ON lend_period
  FOR EACH ROW EXECUTE FUNCTION cx_trg_lend_guard();

CREATE OR REPLACE FUNCTION cx_trg_lend_events() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM cx_emit('lend-cycle-started', 'trigger', 'lend.started', 'lend', NEW.lend_id::text, NEW.borrower_id,
      'Lend started 📦',
      format('Lend #%s of %s — due %s.',
             NEW.lend_id,
             coalesce((SELECT title FROM resource_mirror WHERE resource_id = NEW.resource_id), 'a resource'),
             coalesce(to_char(NEW.due_at, 'DD Mon YYYY HH24:MI'), 'no due date set')),
      '/resources/' || NEW.resource_id, 'info',
      jsonb_build_object('resourceId', NEW.resource_id, 'dueAt', NEW.due_at),
      ARRAY[NEW.owner_id, NEW.borrower_id]);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'returned' AND OLD.status IS DISTINCT FROM 'returned' THEN
      PERFORM cx_emit('lend-cycle-closed', 'trigger', 'lend.returned', 'lend', NEW.lend_id::text, NEW.borrower_id,
        'Lend item returned 📦',
        format('Lend #%s closed after %s day(s).', NEW.lend_id,
               round(EXTRACT(epoch FROM (coalesce(upper(NEW.scope), now()) - lower(NEW.scope))) / 86400, 1)),
        '/resources/' || NEW.resource_id, 'success',
        jsonb_build_object('resourceId', NEW.resource_id, 'heldUntil', NEW.returned_at),
        ARRAY[NEW.owner_id, NEW.borrower_id]);
    ELSIF NEW.status = 'overdue' AND OLD.status IS DISTINCT FROM 'overdue' THEN
      PERFORM cx_emit('overdue-lend-alert', 'trigger', 'lend.overdue', 'lend', NEW.lend_id::text, NEW.borrower_id,
        '⏰ Overdue reminder',
        format('Lend #%s was due %s — %s day(s) late.', NEW.lend_id,
               to_char(NEW.due_at, 'DD Mon YYYY'), floor(EXTRACT(epoch FROM (now() - NEW.due_at)) / 86400)::int),
        '/resources/' || NEW.resource_id, 'warning',
        jsonb_build_object('resourceId', NEW.resource_id, 'dueAt', NEW.due_at),
        ARRAY[NEW.owner_id, NEW.borrower_id]);
    END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_lend_events_t ON lend_period;
CREATE TRIGGER trg_lend_events_t
  AFTER INSERT OR UPDATE ON lend_period
  FOR EACH ROW EXECUTE FUNCTION cx_trg_lend_events();

-- ============================================================================
-- ACTIVE: time-based condition, evaluated by a SQL function (not app logic)
-- ============================================================================
CREATE OR REPLACE FUNCTION cx_check_overdue_lends(p_grace interval DEFAULT interval '0 seconds')
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE lend_period
     SET status = 'overdue', updated_at = now()
   WHERE status = 'out'
     AND due_at IS NOT NULL
     AND due_at < now() - p_grace;      -- CONDITION
  GET DIAGNOSTICS v_n = ROW_COUNT;     -- ACTION happened inside the DB (trigger fired)
  RETURN v_n;
END $$;

COMMENT ON FUNCTION cx_check_overdue_lends(interval) IS
  'ACTIVE: UPDATE-based time condition. The state change fires trg_lend_events_t, which emits the notification.';

-- ============================================================================
-- ACTIVE outbox: concurrency-safe drain (FOR UPDATE SKIP LOCKED)
-- ============================================================================
CREATE OR REPLACE FUNCTION cx_active_drain(p_limit integer DEFAULT 25)
RETURNS SETOF active_event
LANGUAGE sql VOLATILE AS $$
  UPDATE active_event e
     SET delivery_status = 'delivered', delivered_at = now()
    FROM (
      SELECT event_id
        FROM active_event
       WHERE delivery_status = 'pending'
       ORDER BY event_id
       LIMIT greatest(p_limit, 1)
       FOR UPDATE SKIP LOCKED
    ) claimed
   WHERE e.event_id = claimed.event_id
  RETURNING e.*;
$$;

CREATE OR REPLACE FUNCTION cx_active_stats()
RETURNS TABLE (
  pending     bigint,
  delivered   bigint,
  by_source   jsonb,
  by_severity jsonb,
  by_rule     jsonb
)
LANGUAGE sql STABLE AS $$
  SELECT (SELECT count(*) FROM active_event WHERE delivery_status = 'pending'),
         (SELECT count(*) FROM active_event WHERE delivery_status = 'delivered'),
         (SELECT coalesce(jsonb_object_agg(source, c), '{}'::jsonb)
            FROM (SELECT source, count(*) AS c FROM active_event GROUP BY source) s),
         (SELECT coalesce(jsonb_object_agg(severity, c), '{}'::jsonb)
            FROM (SELECT severity, count(*) AS c FROM active_event GROUP BY severity) s),
         (SELECT coalesce(jsonb_object_agg(coalesce(rule_id, '(none)'), c), '{}'::jsonb)
            FROM (SELECT rule_id, count(*) AS c FROM active_event GROUP BY rule_id) s);
$$;

CREATE OR REPLACE FUNCTION cx_rule_toggle(p_rule_id text, p_enabled boolean)
RETURNS active_rule
LANGUAGE sql VOLATILE AS $$
  UPDATE active_rule SET enabled = p_enabled, updated_at = now()
   WHERE rule_id = p_rule_id
  RETURNING *;
$$;

-- ============================================================================
-- TEMPORAL helper used by the seeder: re-date a version pair safely.
-- Shrinks the previous version's valid_to BEFORE moving the next valid_from,
-- so the EXCLUDE constraint is never violated mid-operation.
-- ============================================================================
CREATE OR REPLACE FUNCTION cx_backdate_version(
  p_resource_id text,
  p_version_no  integer,
  p_valid_from  timestamptz,
  p_valid_to    timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE resource_version
     SET valid_to = p_valid_from, system_to = coalesce(system_to, p_valid_from)
   WHERE resource_id = p_resource_id
     AND version_no = p_version_no - 1
     AND valid_to IS NOT NULL;

  UPDATE resource_version
     SET valid_from = p_valid_from,
         recorded_at = p_valid_from,
         valid_to = p_valid_to,
         system_to = p_valid_to
   WHERE resource_id = p_resource_id AND version_no = p_version_no;
END $$;

-- ============================================================================
-- ECA rule registry (seeded data — the triggers reference these rule_ids)
-- ============================================================================
INSERT INTO active_rule (rule_id, name, event, condition_text, action_text, trigger_name) VALUES
  ('notify-on-availability', 'Notify watchers when a resource becomes available',
   'AFTER UPDATE ON resource_mirror WHEN availability -> ''available''',
   'NEW.availability = ''available'' AND NEW.availability IS DISTINCT FROM OLD.availability',
   'INSERT INTO active_event (watch-list recipients) + pg_notify(cx_active) + close open resource_watch rows',
   'trg_resource_events_t'),
  ('availability-state-change', 'Broadcast every availability transition',
   'AFTER UPDATE ON resource_mirror WHEN availability changes',
   'NEW.availability IS DISTINCT FROM OLD.availability',
   'INSERT INTO active_event (owner copy) + pg_notify(cx_active)',
   'trg_resource_events_t'),
  ('price-change-alert', 'Alert watch-list when the price moves',
   'AFTER UPDATE ON resource_mirror WHEN price changes',
   'NEW.price IS DISTINCT FROM OLD.price',
   'INSERT INTO active_event with price delta + pg_notify(cx_active)',
   'trg_resource_events_t'),
  ('ownership-transfer', 'Announce ownership transfer',
   'AFTER UPDATE ON resource_mirror WHEN owner_id changes',
   'NEW.owner_id IS DISTINCT FROM OLD.owner_id',
   'INSERT INTO active_event for both parties + pg_notify(cx_active)',
   'trg_resource_events_t'),
  ('listing-removed', 'Announce removal of a listing',
   'AFTER DELETE ON resource_mirror',
   'true',
   'INSERT INTO active_event (owner copy) + pg_notify(cx_active)',
   'trg_resource_events_t'),
  ('lend-cycle-started', 'Announce a new borrow cycle',
   'AFTER INSERT ON lend_period',
   'true',
   'INSERT INTO active_event for owner + borrower',
   'trg_lend_events_t'),
  ('lend-cycle-closed', 'Announce the return of a lent item',
   'AFTER UPDATE ON lend_period WHEN status -> ''returned''',
   'NEW.status = ''returned'' AND OLD.status <> ''returned''',
   'Close the tstzrange period, emit event, both parties notified',
   'trg_lend_events_t'),
  ('overdue-lend-alert', 'Flag and notify overdue lends',
   'AFTER UPDATE ON lend_period WHEN status -> ''overdue'' (set by cx_check_overdue_lends)',
   'NEW.status = ''overdue'' AND OLD.status <> ''overdue''',
   'INSERT INTO active_event severity=warning for owner + borrower',
   'trg_lend_events_t')
ON CONFLICT (rule_id) DO UPDATE
  SET name = EXCLUDED.name,
      event = EXCLUDED.event,
      condition_text = EXCLUDED.condition_text,
      action_text = EXCLUDED.action_text,
      trigger_name = EXCLUDED.trigger_name,
      updated_at = now();

-- CX_CONTINUE
