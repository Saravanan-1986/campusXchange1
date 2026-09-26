import { rows, row, query } from '../../config/pg.js';
import { pgInfo } from '../../config/pg.js';

/**
 * ACTIVE DATABASE service — reads the state the *database* produced.
 * Nothing here decides anything: the triggers wrote active_event rows and fired
 * pg_notify; this module exposes that outbox, the ECA rule registry (§ fired
 * counters) and PostgreSQL's own catalog for the admin monitor.
 */
function numRow(r) {
  if (!r) return r;
  const out = { ...r };
  for (const k of ['pending', 'delivered', 'fire_count', 'live_rows', 'size_bytes',
    'seq_scans', 'index_scans', 'inserts', 'updates', 'deletes', 'scans']) {
    if (k in out) out[k] = Number(out[k]);
  }
  return out;
}

/** Recent events produced by triggers (the ECA audit trail). */
export async function listEvents({ limit = 40, status = null, entityType = null, entityId = null } = {}) {
  const data = await rows(
    `SELECT event_id::text, rule_id, source, event_type, entity_type, entity_id, actor_id,
            title, message, link, severity, payload, recipients, created_at,
            delivered_at, delivery_status
       FROM active_event
      WHERE ($1::text IS NULL OR delivery_status = $1)
        AND ($2::text IS NULL OR entity_type = $2)
        AND ($3::text IS NULL OR entity_id = $3)
      ORDER BY event_id DESC
      LIMIT $4`,
    [status, entityType, entityId ? String(entityId) : null,
     Math.min(Math.max(Number(limit) || 40, 1), 200)],
    'active-events'
  );
  return data;
}

export async function eventForEntity(entityId, limit = 20) {
  return listEvents({ entityId, limit });
}

export async function stats() {
  return numRow(await row(`SELECT * FROM cx_active_stats()`, [], 'active-stats'));
}

/** The ECA registry, as stored in the database. */
export async function listRules() {
  const data = await rows(
    `SELECT rule_id, name, event, condition_text, action_text, trigger_name, enabled,
            fire_count, last_fired_at, updated_at
       FROM active_rule ORDER BY fire_count DESC, rule_id`, [], 'active-rules'
  );
  return data.map(numRow);
}

export async function toggleRule(ruleId, enabled) {
  const r = await row(`SELECT * FROM cx_rule_toggle($1, $2)`, [ruleId, !!enabled], 'toggle-rule');
  if (!r) throw Object.assign(new Error(`Unknown ECA rule: ${ruleId}`), { status: 404 });
  return numRow(r);
}

/** Introspection: the actual triggers installed in this database. */
export async function triggerCatalog() {
  return rows(`SELECT * FROM cx_trigger_catalog()`, [], 'trigger-catalog');
}

export async function tableStats() {
  const data = await rows(`SELECT * FROM cx_table_stats()`, [], 'table-stats');
  return data.map(numRow);
}

export async function indexUsage() {
  return rows(`SELECT * FROM cx_index_usage()`, [], 'index-usage');
}

export async function internals() {
  const info = await row(`SELECT cx_pg_internals() AS internals`, [], 'pg-internals');
  return { ...info?.internals, pool: pgInfo() };
}

/** The full PostgreSQL panel payload for the admin monitor. */
export async function monitorBlock() {
  const [int, rules, trigs, evts, st] = await Promise.all([
    internals(), listRules(), triggerCatalog(), listEvents({ limit: 12 }), stats(),
  ]);
  return { internals: int, rules, triggers: trigs, recentEvents: evts, stats: st };
}

/**
 * Deliver pending outbox rows (FOR UPDATE SKIP LOCKED).
 * Used both by the LISTEN listener (instant) and the cron safety net.
 */
export async function drainOutbox(limit = 25) {
  return rows(`SELECT * FROM cx_active_drain($1)`, [Number(limit) || 25], 'drain-outbox');
}

/**
 * Demo helper: change the price directly in the mirror. This bypasses the API
 * logic on purpose — it proves the *database* triggers on write.
 */
export async function pokePrice(resourceId, newPrice) {
  const r = await row(
    `UPDATE resource_mirror SET price = $2, updated_at = now()
      WHERE resource_id = $1
      RETURNING resource_id, price`, [String(resourceId), Number(newPrice)], 'poke-price'
  );
  if (!r) throw Object.assign(new Error('Unknown resource_id'), { status: 404 });
  return numRow(r);
}

/** Demo helper: flip availability (drives the notify-on-availability rule). */
export async function pokeAvailability(resourceId, availability) {
  const r = await row(
    `UPDATE resource_mirror SET availability = $2, updated_at = now()
      WHERE resource_id = $1
      RETURNING resource_id, availability`, [String(resourceId), availability], 'poke-availability'
  );
  if (!r) throw Object.assign(new Error('Unknown resource_id'), { status: 404 });
  return r;
}

/** Raw count used by health checks. */
export async function pendingCount() {
  const r = await row(`SELECT count(*)::int AS pending FROM active_event WHERE delivery_status = 'pending'`, [], 'pending-count');
  return r?.pending ?? 0;
}

export { query };
