import { query, row, pgStatus } from '../../config/pg.js';

/**
 * MongoDB → PostgreSQL write-through mirror.
 *
 * MongoDB stays the source of truth for documents. Every mutation also lands in
 * PostgreSQL, where the *triggers* own the interesting work:
 *   resource_mirror  → resource_version (temporal history) + active_event (ECA)
 *   geo_resource     → nearest campus zone (spatial trigger)
 *   lend_period      → borrow periods + overlap protection
 *   resource_watch   → the watch-list the availability rule notifies
 *   search_doc       → tsvector full-text index
 *
 * Every helper is fail-soft: if PostgreSQL is down the API keeps working on
 * MongoDB, and the degradation shows up in /api/system/status.
 */
let warned = false;

function warn(where, err) {
  if (pgStatus() !== 'connected') {
    if (!warned) {
      console.warn(`[pg-sync] ${where}: PostgreSQL not connected — mirror skipped (MongoDB unaffected)`);
      warned = true;
    }
    return;
  }
  console.error(`[pg-sync] ${where} failed:`, err.message);
}

async function safe(where, fn) {
  try {
    return await fn();
  } catch (err) {
    warn(where, err);
    return null;
  }
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Create/update the resource mirror row (fires the history + ECA triggers). */
export function upsertResourceMirror(resource, ownerName = '') {
  return safe('upsertResourceMirror', async () => {
    await query(
      `INSERT INTO resource_mirror (
         resource_id, title, category, subject, department, semester, condition,
         listing_type, price, availability, status, owner_id, owner_label, rating_avg, rating_count, is_listed
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$12,$13,$14,$15)
       ON CONFLICT (resource_id) DO UPDATE SET
         title        = EXCLUDED.title,
         category     = EXCLUDED.category,
         subject      = EXCLUDED.subject,
         department   = EXCLUDED.department,
         semester     = EXCLUDED.semester,
         condition    = EXCLUDED.condition,
         listing_type = EXCLUDED.listing_type,
         price        = EXCLUDED.price,
         availability = EXCLUDED.availability,
         status       = 'active',
         owner_id     = EXCLUDED.owner_id,
         owner_label  = EXCLUDED.owner_label,
         rating_avg   = EXCLUDED.rating_avg,
         rating_count = EXCLUDED.rating_count,
         is_listed    = EXCLUDED.is_listed,
         updated_at   = now()`,
      [
        String(resource._id),
        resource.title || 'Untitled',
        resource.category || 'other',
        resource.subject || '',
        resource.department || '',
        resource.semester ? Number(resource.semester) : null,
        resource.condition || 'good',
        resource.listingType || 'sell',
        Number(resource.price || 0),
        resource.availability || 'available',
        String(resource.ownerId?._id || resource.ownerId),
        ownerName || resource.ownerId?.name || '',
        num(resource.ratingAvg) ?? 0,
        Number(resource.ratingCount || 0),
        resource.isListed !== false,
      ],
      'upsertResourceMirror'
    );

    const coords = resource.location?.coordinates || [];
    if (coords.length === 2) {
      const [lon, lat] = coords.map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
        await upsertGeoResource(String(resource._id), String(resource.ownerId?._id || resource.ownerId),
          lon, lat, resource.location.label || '');
      }
    }
    return true;
  });
}

/** SPATIAL: upsert the resource point; the trigger snaps the nearest zone. */
export function upsertGeoResource(resourceId, ownerId, lon, lat, label = '') {
  return safe('upsertGeoResource', async () => {
    await query(
      `INSERT INTO geo_resource (resource_id, owner_id, lat, lon, label)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (resource_id) DO UPDATE
         SET lat = EXCLUDED.lat, lon = EXCLUDED.lon, label = EXCLUDED.label,
             owner_id = EXCLUDED.owner_id, updated_at = now()`,
      [String(resourceId), String(ownerId), Number(lat), Number(lon), label],
      'upsertGeoResource'
    );
    return true;
  });
}

/** SPATIAL: upsert the student point (same zone-snapping trigger). */
export function upsertGeoUser(user) {
  return safe('upsertGeoUser', async () => {
    const [lon, lat] = (user.location?.coordinates || []).map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return false;
    await query(
      `INSERT INTO geo_user (user_id, name, department, role, lat, lon, label)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id) DO UPDATE
         SET name = EXCLUDED.name, department = EXCLUDED.department, role = EXCLUDED.role,
             lat = EXCLUDED.lat, lon = EXCLUDED.lon, label = EXCLUDED.label, updated_at = now()`,
      [String(user._id), user.name || '', user.department || '', user.role || 'student',
       Number(lat), Number(lon), user.location?.label || ''],
      'upsertGeoUser'
    );
    return true;
  });
}
/** Soft-delete: keeps the temporal history readable, hides it from the app. */
export function markResourceDeleted(resourceId) {
  return safe('markResourceDeleted', async () => {
    await query(`UPDATE resource_mirror
                    SET status = 'deleted', availability = 'unavailable', updated_at = now()
                  WHERE resource_id = $1`, [String(resourceId)], 'markResourceDeleted');
    await query(`DELETE FROM search_doc WHERE doc_id = $1`, [String(resourceId)], 'deleteSearchDoc');
    return true;
  });
}

/** Hard delete, used by the seeder's wipe (cascades versions + geo rows). */
export function purgeResource(resourceId) {
  return safe('purgeResource', async () => {
    await query(`DELETE FROM search_doc WHERE doc_id = $1`, [String(resourceId)], 'purgeSearchDoc');
    await query(`DELETE FROM geo_resource WHERE resource_id = $1`, [String(resourceId)], 'purgeGeo');
    await query(`DELETE FROM resource_mirror WHERE resource_id = $1`, [String(resourceId)], 'purgeMirror');
    return true;
  });
}

/** ACTIVE: the watch-list that the notify-on-availability rule reads. */
export function upsertWatch(resourceId, userId, kind = 'availability') {
  return safe('upsertWatch', async () => {
    await query(
      `INSERT INTO resource_watch (resource_id, user_id, kind) VALUES ($1,$2,$3)
       ON CONFLICT (resource_id, user_id, kind) DO UPDATE SET status = 'open'`,
      [String(resourceId), String(userId), kind], 'upsertWatch'
    );
    return true;
  });
}

export function cancelWatch(resourceId, userId, kind = 'availability') {
  return safe('cancelWatch', async () => {
    await query(`UPDATE resource_watch SET status = 'cancelled'
                  WHERE resource_id = $1 AND user_id = $2 AND kind = $3`,
      [String(resourceId), String(userId), kind], 'cancelWatch');
    return true;
  });
}

/** TEMPORAL: open a borrow cycle. The EXCLUDE constraint rejects overlaps. */
export async function openLendPeriod({ resourceId, transactionId, ownerId, borrowerId, dueAt, note = '' }) {
  try {
    const r = await row(
      `INSERT INTO lend_period (resource_id, transaction_id, owner_id, borrower_id, scope, due_at, status, note)
       VALUES ($1,$2,$3,$4, tstzrange(clock_timestamp(), NULL), $5, 'out', $6)
       RETURNING lend_id::text, lower(scope) AS lent_at, due_at, status`,
      [String(resourceId), transactionId ? String(transactionId) : null,
       String(ownerId), String(borrowerId), dueAt ? new Date(dueAt) : null, note],
      'openLendPeriod'
    );
    return { ok: true, lend: r };
  } catch (err) {
    // 23P01 = exclusion_violation → the database refused a double-lending
    if (err.code === '23P01') {
      return {
        ok: false,
        code: 'DOUBLE_LEND',
        message: 'This item is already lent out — the valid-time period overlap was blocked by PostgreSQL.',
      };
    }
    warn('openLendPeriod', err);
    return { ok: false, code: 'PG_ERROR', message: err.message };
  }
}

export function closeLendPeriod({ lendId = null, resourceId = null, transactionId = null, at = new Date() }) {
  return safe('closeLendPeriod', async () => {
    const res = await query(
      `UPDATE lend_period
          SET scope = tstzrange(lower(scope), $1),
              status = 'returned', returned_at = $1, updated_at = now()
        WHERE status IN ('out', 'overdue')
          AND ( ($2::bigint IS NOT NULL AND lend_id = $2::bigint)
             OR ($2::bigint IS NULL AND resource_id = $3
                 AND ($4::text IS NULL OR transaction_id = $4::text)) )`,
      [at, lendId ? Number(lendId) : null, resourceId ? String(resourceId) : null,
       transactionId ? String(transactionId) : null],
      'closeLendPeriod'
    );
    return res.rowCount;
  });
}

export function cancelLendPeriod(resourceId, transactionId = null) {
  return safe('cancelLendPeriod', async () => {
    const res = await query(
      `UPDATE lend_period SET status = 'cancelled', updated_at = now()
        WHERE resource_id = $1 AND ($2::text IS NULL OR transaction_id = $2::text)
          AND status IN ('out', 'overdue')`,
      [String(resourceId), transactionId ? String(transactionId) : null], 'cancelLendPeriod'
    );
    return res.rowCount;
  });
}
/** SEARCH: keep the tsvector read-model in sync. */
export function upsertSearchDoc({ id, kind, title, body = '', tags = [], department = '', subject = '',
  category = '', semester = null, price = null, availability = null, ownerId = null }) {
  return safe('upsertSearchDoc', async () => {
    const cleanTags = (tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
    await query(
      `INSERT INTO search_doc (doc_id, kind, title, body, tag_text, tags, department, subject,
                               category, semester, price, availability, owner_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
       ON CONFLICT (doc_id) DO UPDATE SET
         kind = EXCLUDED.kind, title = EXCLUDED.title, body = EXCLUDED.body,
         tag_text = EXCLUDED.tag_text, tags = EXCLUDED.tags, department = EXCLUDED.department,
         subject = EXCLUDED.subject, category = EXCLUDED.category, semester = EXCLUDED.semester,
         price = EXCLUDED.price, availability = EXCLUDED.availability, owner_id = EXCLUDED.owner_id,
         updated_at = now()`,
      [String(id), kind, title || '', body || '', cleanTags.join(' '), cleanTags,
       department || '', subject || '', category || '',
       semester ? Number(semester) : null,
       price === null || price === undefined ? null : Number(price),
       availability || null, ownerId ? String(ownerId) : null],
      'upsertSearchDoc'
    );
    return true;
  });
}

export function removeSearchDoc(id) {
  return safe('removeSearchDoc', async () => {
    await query(`DELETE FROM search_doc WHERE doc_id = $1`, [String(id)], 'removeSearchDoc');
    return true;
  });
}

/** Denormalized rating aggregates, kept in the mirror for SQL reporting. */
export function syncRatingAggregates(resourceId, ratingAvg, ratingCount) {
  return safe('syncRatingAggregates', async () => {
    await query(`UPDATE resource_mirror SET rating_avg = $2, rating_count = $3, updated_at = now()
                  WHERE resource_id = $1`,
      [String(resourceId), num(ratingAvg) ?? 0, Number(ratingCount || 0)], 'syncRatingAggregates');
    return true;
  });
}

/** Wipe every mirror table (seeder). */
export function wipeMirrors() {
  return safe('wipeMirrors', async () => {
    await query(`TRUNCATE search_doc, resource_watch, active_event, lend_period,
                          resource_version, geo_resource, geo_user, resource_mirror
                 RESTART IDENTITY CASCADE`, [], 'wipeMirrors');
    await query(`UPDATE active_rule SET fire_count = 0, last_fired_at = NULL`, [], 'resetRules');
    return true;
  });
}
/**
 * Convenience aliases for routes / seeder.
 *
 *  syncResourceToPostgres   → upserts resource_mirror + geo_resource + search_doc
 *  deleteResourceFromPostgres → marks deleted in mirror, deletes from search_doc
 *  syncUserToPostgres       → upserts geo_user (if location is provided)
 *  syncTransactionToPostgres → no-op or transaction mirror
 */
export async function syncResourceToPostgres(resource, { actorLabel = '', reason = '' } = {}) {
  const ok = await upsertResourceMirror(resource, actorLabel);
  // Also keep full-text search index in sync
  await upsertSearchDoc({
    id: resource._id,
    kind: 'resource',
    title: resource.title,
    body: resource.description || '',
    tags: resource.tags || [],
    department: resource.department || '',
    subject: resource.subject || '',
    category: resource.category || '',
    semester: resource.semester,
    price: resource.price,
    availability: resource.availability,
    ownerId: resource.ownerId?._id || resource.ownerId,
  });
  // SPATIAL: coordinates live in PG geo_resource (the Nearby-items source).
  // upsertResourceMirror already geo-tags from resource.location, but belt-and-
  // braces here for resources saved before their location was attached.
  try {
    const coords = resource.location?.coordinates || [];
    if (coords.length === 2) {
      const [lon, lat] = coords.map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
        await upsertGeoResource(
          String(resource._id),
          String(resource.ownerId?._id || resource.ownerId || ''),
          lon, lat, resource.location.label || ''
        );
      }
    }
  } catch { /* spatial is best-effort — never fail the listing save */ }
  return ok;
}

export async function deleteResourceFromPostgres(resourceId, { actorLabel = '', reason = '' } = {}) {
  return markResourceDeleted(resourceId);
}

export async function syncUserToPostgres(user) {
  return upsertGeoUser(user);
}

export async function syncTransactionToPostgres(tx) {
  // If transaction has an active lend status, lend_period is managed by
  // openLendPeriod/closeLendPeriod in temporal.service / transaction.routes.
  return true;
}


