import { query, rows, row, pgStatus } from '../../config/pg.js';
import { env } from '../../config/env.js';

/**
 * TEMPORAL PARADIGM service — everything that answers "what was true when?".
 * PostgreSQL stores each resource state as a SQL:2011 style valid-time row and
 * each borrow cycle as a tstzrange period, so all of it is plain SQL:
 * interval adjacency, as-of queries, overlap detection, period arithmetic.
 */
const n = (v) => (v === null || v === undefined ? null : Number(v));

function numRow(r) {
  if (!r) return r;
  const out = { ...r };
  for (const k of ['price', 'delta', 'pct_change', 'held_days', 'span_days',
    'avg_versions_per_item', 'total_borrow_days', 'days_overdue']) {
    if (k in out) out[k] = n(out[k]);
  }
  return out;
}

export function available() {
  return pgStatus() === 'connected';
}

/** Full lifecycle timeline (oldest → newest) straight from resource_version. */
export async function getTimeline(resourceId) {
  const data = await rows(
    `SELECT version_id::text, resource_id, version_no, valid_from, valid_to,
            recorded_at, system_to, price, condition, availability, listing_type,
            owner_id, owner_label, title, changed_fields, change_note, written_by,
            (valid_to IS NULL) AS is_current
       FROM resource_version
      WHERE resource_id = $1
      ORDER BY version_no`,
    [String(resourceId)], 'timeline'
  );
  return data.map(numRow);
}

/** The row whose valid-time interval is still open. */
export async function getCurrentState(resourceId) {
  return numRow(await row(
    `SELECT * FROM v_resource_current WHERE resource_id = $1`,
    [String(resourceId)], 'current-state'
  ));
}

/**
 * AS-OF query — "what did this listing look like at time T?".
 * Two predicates on the valid-time interval; impossible to express this well in
 * a plain document store.
 */
export async function getAsOf(resourceId, at) {
  const ts = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(ts.getTime())) {
    throw Object.assign(new Error('Invalid timestamp for as-of query'), { status: 400 });
  }
  const r = await row(`SELECT * FROM cx_resource_as_of($1, $2)`, [String(resourceId), ts], 'as-of');
  return { at: ts, state: numRow(r) };
}

/** Price movements with window-function deltas. */
export async function getPriceTrajectory(resourceId) {
  const data = await rows(`SELECT * FROM cx_price_trajectory($1)`, [String(resourceId)], 'price-trajectory');
  return data.map(numRow);
}

/** Valid-time coverage audit: overlaps must be 0 (EXCLUDE constraint), gaps reported. */
export async function getIntegrity(resourceId = null) {
  const data = await rows(`SELECT * FROM cx_temporal_integrity($1)`, [resourceId], 'integrity');
  return data.map(numRow);
}

/** Interval proof panel: each stored period + whether it is adjacent to the next. */
export async function getIntervalProof(resourceId = null, limit = 25) {
  const data = await rows(
    `SELECT resource_id, version_no, valid_from, valid_to,
            tstzrange(valid_from, valid_to, '[)')                       AS stored_period,
            LEAD(valid_from) OVER (PARTITION BY resource_id ORDER BY version_no) AS next_valid_from,
            (valid_to IS NOT NULL
              AND LEAD(valid_from) OVER (PARTITION BY resource_id ORDER BY version_no) = valid_to) AS adjacent,
            upper(tstzrange(valid_from, valid_to, '[)')) IS NULL          AS open_ended
       FROM resource_version
      WHERE ($1::text IS NULL OR resource_id = $1)
      ORDER BY resource_id, version_no
      LIMIT $2`,
    [resourceId, Math.min(Math.max(Number(limit) || 25, 1), 200)], 'interval-proof'
  );
  return data.map(numRow);
}

/** Borrow cycles (valid-time periods) with SQL-computed overdue severity. */
export async function getLendActivity({ status = null, limit = 60 } = {}) {
  const data = await rows(
    `SELECT * FROM v_lend_activity
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY CASE status WHEN 'overdue' THEN 0 WHEN 'out' THEN 1 ELSE 2 END, due_at NULLS LAST
      LIMIT $2`,
    [status, Math.min(Math.max(Number(limit) || 60, 1), 300)], 'lend-activity'
  );
  return data.map(numRow);
}
/** Global temporal counters + the most-versioned listings + daily trend. */
export async function getSummary() {
  const stats = await row(
    `SELECT (SELECT count(*) FROM resource_version)                       AS versions,
            (SELECT count(DISTINCT resource_id) FROM resource_version)     AS resources,
            (SELECT count(*) FROM resource_version WHERE valid_to IS NULL) AS open_intervals,
            (SELECT count(*) FROM resource_version WHERE array_length(changed_fields, 1) >= 1) AS states_changed,
            (SELECT coalesce(round(avg(v), 2), 0) FROM (
                SELECT count(*)::numeric AS v FROM resource_version GROUP BY resource_id) t) AS avg_versions_per_item,
            (SELECT count(*) FROM lend_period)                             AS lend_periods,
            (SELECT count(*) FROM lend_period WHERE status = 'out')        AS lends_out,
            (SELECT count(*) FROM lend_period WHERE status = 'overdue')    AS lends_overdue,
            (SELECT count(*) FROM lend_period WHERE status = 'returned')   AS lends_returned,
            (SELECT coalesce(round(sum(EXTRACT(epoch FROM (coalesce(upper(scope), now()) - lower(scope))) / 86400)::numeric, 1), 0)
               FROM lend_period)                                           AS total_borrow_days`,
    [], 'temporal-summary'
  );
  const busiest = await rows(
    `SELECT m.resource_id, m.title, count(v.version_id)::int AS versions,
            max(v.valid_from) AS last_change,
            (SELECT count(*) FROM lend_period l WHERE l.resource_id = m.resource_id)::int AS lends
       FROM resource_mirror m
       JOIN resource_version v ON v.resource_id = m.resource_id
      GROUP BY m.resource_id, m.title
      HAVING count(v.version_id) > 1
      ORDER BY versions DESC, last_change DESC
      LIMIT 8`, [], 'busiest-resources'
  );
  const trend = await rows(`SELECT * FROM cx_listing_trend(14)`, [], 'version-trend');
  return { stats: numRow(stats), busiest, trend: trend.map(numRow) };
}

/**
 * ACTIVE + TEMPORAL: ask the database to flag overdue lends.
 * The UPDATE inside cx_check_overdue_lends() fires trg_lend_events_t, which
 * writes the notification — the API only triggers the check.
 */
export async function runOverdueCheck() {
  const r = await row(`SELECT cx_check_overdue_lends(make_interval(hours => $1)) AS changed`,
    [env.lendGraceHours], 'overdue-check');
  return { changed: Number(r?.changed || 0), graceHours: env.lendGraceHours };
}

/** Rebuild the analytics materialized view (cron + admin button). */
export async function refreshAnalytics() {
  const r = await row(`SELECT cx_refresh_analytics() AS refreshed_at`, [], 'refresh-analytics');
  return r?.refreshed_at;
}

/** Read-only SQL console used by the admin panel (single SELECT only). */
export async function runReadOnlySql(sql, params = []) {
  const trimmed = String(sql || '').trim();
  if (!/^select\s/i.test(trimmed)) {
    throw Object.assign(new Error('Only SELECT statements are allowed in the SQL console'), { status: 400 });
  }
  if (/;\s*\S/.test(trimmed)) {
    throw Object.assign(new Error('Multiple statements are not allowed in the SQL console'), { status: 400 });
  }
  const started = Date.now();
  const res = await query(trimmed, params, 'sql-console');
  return {
    rows: res.rows,
    rowCount: res.rowCount,
    columns: res.fields.map((f) => f.name),
    ms: Date.now() - started,
  };
}

/**
 * Record a lend period directly in PostgreSQL.
 * Supported by GiST exclusion constraint `cx_no_overlapping_lends`.
 */
export async function recordLendPeriod({ resourceId, borrowerId, borrowerLabel = '', lendStart = new Date(), lendEnd = null, transactionId = null, ownerId = null }) {
  const start = lendStart instanceof Date ? lendStart : new Date(lendStart);
  const end = lendEnd ? (lendEnd instanceof Date ? lendEnd : new Date(lendEnd)) : null;

  // lend_period.owner_id is NOT NULL — fall back to the mirrored owner
  // so callers (seeder, transaction route) don't have to resolve it.
  let owner = ownerId ? String(ownerId) : null;
  if (!owner) {
    const m = await row(
      `SELECT owner_id FROM resource_mirror WHERE resource_id = $1`,
      [String(resourceId)], 'recordLendPeriod:owner'
    );
    owner = m?.owner_id || String(borrowerId);
  }

  const res = await query(
    `INSERT INTO lend_period (resource_id, transaction_id, owner_id, borrower_id, scope, due_at, status)
     VALUES ($1, $2, $3, $4, tstzrange($5, $6, '[)'), $7, 'out')
     RETURNING lend_id::text, lower(scope) AS lent_at, due_at, status`,
    [
      String(resourceId),
      transactionId ? String(transactionId) : null,
      owner,
      String(borrowerId),
      start,
      null, // open-ended until returned
      end,
    ],
    'recordLendPeriod'
  );
  return res.rows[0];
}

/**
 * Close an active lend period when the item is returned.
 */
export async function closeLendPeriod(resourceId, borrowerId = null, returnedAt = new Date()) {
  const at = returnedAt instanceof Date ? returnedAt : new Date(returnedAt);
  const res = await query(
    `UPDATE lend_period
        SET scope = tstzrange(lower(scope), $1, '[)'),
            status = 'returned',
            returned_at = $1,
            updated_at = now()
      WHERE resource_id = $2
        AND status IN ('out', 'overdue')
        AND ($3::text IS NULL OR borrower_id = $3)`,
    [at, String(resourceId), borrowerId ? String(borrowerId) : null],
    'closeLendPeriod'
  );
  return res.rowCount;
}

/**
 * Backdate a temporal version in resource_version table.
 * Uses PL/pgSQL function cx_backdate_version or explicit queries to bypass GiST constraint.
 */
export async function backdateVersion(resourceId, {
  title = '',
  category = 'other',
  condition = 'good',
  price = 0,
  availability = 'available',
  listingType = 'sell',
  ownerId = '',
  ownerLabel = '',
  actorLabel = '',
  validFrom,
  validTo = null,
  reason = '',
}) {
  const from = validFrom instanceof Date ? validFrom : new Date(validFrom);
  const to = validTo ? (validTo instanceof Date ? validTo : new Date(validTo)) : null;

  // Ensure mirror row exists so FK is happy
  await query(
    `INSERT INTO resource_mirror (resource_id, title, category, price, availability, listing_type, owner_id, owner_label)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (resource_id) DO NOTHING`,
    [String(resourceId), title || 'Untitled', category, Number(price || 0), availability, listingType, String(ownerId), ownerLabel],
    'backdate-ensure-mirror'
  );

  // (Each statement below is atomic; backdating runs sequentially from the
  // seeder or admin console, and only touches resource_version — never the
  // mirror — so the cx_trg_resource_version trigger cannot race it.)

  // Check next version number
  const vRes = await row(
    `SELECT coalesce(max(version_no), 0) + 1 AS next_v FROM resource_version WHERE resource_id = $1`,
    [String(resourceId)]
  );
  const vNo = Number(vRes?.next_v || 1);

  if (vNo === 1) {
    // No history yet → first version covers [from, to).
    return (await query(
      `INSERT INTO resource_version (
         resource_id, version_no, valid_from, valid_to, recorded_at, system_to,
         price, condition, availability, listing_type, owner_id, owner_label,
         title, changed_fields, change_note, written_by
       ) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING version_id::text`,
      [String(resourceId), from, to, from, to, Number(price || 0), condition,
       availability, listingType, String(ownerId), ownerLabel, title || 'Untitled',
       ['price'], reason || 'Backdated version', actorLabel || 'system:seed'],
      'backdate-insert-first'
    )).rows[0];
  }

  const oldest = await row(
    `SELECT valid_from FROM resource_version WHERE resource_id = $1
      ORDER BY version_no LIMIT 1`,
    [String(resourceId)], 'backdate-oldest'
  );

  if (oldest && from < new Date(oldest.valid_from)) {
    // CASE A — the new interval starts BEFORE existing history.
    // Re-date the oldest version in place to [from, to) with the new payload
    // (mirrors PL/pgSQL cx_backdate_version), then push any successor that
    // started at the old boundary so intervals stay adjacent ([) bounds).
    const oldestV = await row(
      `SELECT version_no FROM resource_version WHERE resource_id = $1
        ORDER BY version_no LIMIT 1`,
      [String(resourceId)], 'backdate-oldest-no'
    );
    const upd = await query(
      `UPDATE resource_version
          SET valid_from = $1, valid_to = $2,
              recorded_at = least(recorded_at, $1), system_to = $2,
              price = $3, condition = $4, availability = $5, listing_type = $6,
              owner_id = $7, owner_label = $8, title = $9,
              changed_fields = $10, change_note = $11, written_by = $12
        WHERE resource_id = $13 AND version_no = $14
        RETURNING version_id::text`,
      [from, to, Number(price || 0), condition, availability, listingType,
       String(ownerId), ownerLabel, title || 'Untitled',
       ['price'], reason || 'Backdated version', actorLabel || 'system:seed',
       String(resourceId), oldestV.version_no],
      'backdate-oldest-rewrite'
    );
    if (to !== null) {
      // Successor rows that began at the old oldest boundary move to `to`
      // (only when that keeps their interval non-empty).
      await query(
        `UPDATE resource_version
            SET valid_from = $2, recorded_at = least(recorded_at, $2)
          WHERE resource_id = $1 AND version_no <> $4
            AND valid_from = $3
            AND (valid_to IS NULL OR valid_to >= $2)`,
        [String(resourceId), to, oldest.valid_from, oldestV.version_no],
        'backdate-shift-successor'
      );
    }
    return upd.rows[0];
  }

  // CASE B — normal append: close the previous version at `from` only when
  // it actually spans `from` (valid_from < from and still open/later).
  await query(
    `UPDATE resource_version
        SET valid_to = $1, system_to = coalesce(system_to, $1)
      WHERE resource_id = $2 AND version_no = $3
        AND valid_from < $1
        AND (valid_to IS NULL OR valid_to > $1)`,
    [from, String(resourceId), vNo - 1],
    'backdate-shrink-prev'
  );

  return await insertTail();

  async function insertTail() {
    const res = await query(
    `INSERT INTO resource_version (
       resource_id, version_no, valid_from, valid_to, recorded_at, system_to,
       price, condition, availability, listing_type, owner_id, owner_label,
       title, changed_fields, change_note, written_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING version_id`,
    [
      String(resourceId),
      vNo,
      from,
      to,
      from,
      to,
      Number(price || 0),
      condition,
      availability,
      listingType,
      String(ownerId),
      ownerLabel,
      title,
      ['price', 'availability'],
      reason || 'Backdated version',
      actorLabel || 'system:seed',
    ],
    'backdate-insert'
  );

  return res.rows[0];
  }
}


export { rows, row, query };

