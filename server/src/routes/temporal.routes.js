import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as temporal from '../services/pg/temporal.service.js';
import { resourceSpot } from '../services/pg/spatial.service.js';
import { pgInfo, pgStatus } from '../config/pg.js';
import { logDbEvent } from '../services/eventlog.service.js';

/**
 * TEMPORAL PARADIGM endpoints — served by PostgreSQL (resource_version + lend_period).
 *
 *   GET /api/temporal/resources/:id/timeline     versioned lifecycle
 *   GET /api/temporal/resources/:id/as-of?at=…   time travel
 *   GET /api/temporal/resources/:id/prices       price trajectory (window fn)
 *   GET /api/temporal/resources/:id/spot         campus zone + distance
 *   GET /api/temporal/integrity?resourceId=…     overlap/gap audit
 *   GET /api/temporal/intervals?resourceId=…     stored tstzrange proof
 *   GET /api/temporal/summary                    counters + trend
 *   GET /api/temporal/lends?status=…             borrow periods
 *   POST /api/temporal/lends/overdue-check       run the SQL active check (admin)
 */
const router = express.Router();

function guard(res) {
  if (pgStatus() !== 'connected') {
    res.status(503).json({
      message: 'PostgreSQL temporal layer is unavailable — run `npm run db:migrate` and check server/.env',
      temporal: pgInfo(),
    });
    return false;
  }
  return true;
}

router.get('/status', (req, res) => res.json({ postgres: pgInfo(), available: pgStatus() === 'connected' }));

router.get('/summary', async (req, res, next) => {
  try {
    if (!guard(res)) return;
    const summary = await temporal.getSummary();
    res.json(summary);
  } catch (err) { next(err); }
});

router.get('/resources/:id/timeline', async (req, res, next) => {
  try {
    if (!guard(res)) return;
    const [versions, current, integrity, spot] = await Promise.all([
      temporal.getTimeline(req.params.id),
      temporal.getCurrentState(req.params.id),
      temporal.getIntegrity(req.params.id),
      resourceSpot(req.params.id),
    ]);
    if (!versions.length) {
      return res.status(404).json({ message: 'No temporal history for this resource (not mirrored yet)' });
    }
    await logDbEvent('temporal', 'query.timeline', `Timeline of ${req.params.id} → ${versions.length} version(s)`, {});
    res.json({
      source: 'postgresql',
      table: 'resource_version',
      versions,
      current,
      integrity: integrity[0] || null,
      spot,
    });
  } catch (err) { next(err); }
});

router.get('/resources/:id/as-of', async (req, res, next) => {
  try {
    if (!guard(res)) return;
    const at = req.query.at || new Date().toISOString();
    const result = await temporal.getAsOf(req.params.id, at);
    await logDbEvent('temporal', 'query.as_of', `AS-OF query at ${new Date(result.at).toISOString()}`, { resource: req.params.id });
    res.json({ source: 'postgresql', sql: 'SELECT * FROM cx_resource_as_of($1,$2)', ...result });
  } catch (err) { next(err); }
});

router.get('/resources/:id/prices', async (req, res, next) => {
  try {
    if (!guard(res)) return;
    res.json({
      source: 'postgresql',
      trajectory: await temporal.getPriceTrajectory(req.params.id),
    });
  } catch (err) { next(err); }
});

router.get('/integrity', async (req, res, next) => {
  try {
    if (!guard(res)) return;
    res.json({
      source: 'postgresql',
      note: 'overlap_count must always be 0 — the EXCLUDE constraint (resource_id =, tstzrange &&) enforces it.',
      integrity: await temporal.getIntegrity(req.query.resourceId || null),
    });
  } catch (err) { next(err); }
});

router.get('/intervals', async (req, res, next) => {
  try {
    if (!guard(res)) return;
    res.json({
      source: 'postgresql',
      intervals: await temporal.getIntervalProof(req.query.resourceId || null, req.query.limit),
    });
  } catch (err) { next(err); }
});

router.get('/lends', async (req, res, next) => {
  try {
    if (!guard(res)) return;
    res.json({ source: 'postgresql', lends: await temporal.getLendActivity({ status: req.query.status, limit: req.query.limit }) });
  } catch (err) { next(err); }
});

router.post('/lends/overdue-check', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!guard(res)) return;
    const result = await temporal.runOverdueCheck();
    await logDbEvent('active', 'cron.overdue_check', `cx_check_overdue_lends() flagged ${result.changed} lend(s)`, result);
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/analytics/refresh', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!guard(res)) return;
    const refreshedAt = await temporal.refreshAnalytics();
    res.json({ ok: true, refreshedAt });
  } catch (err) { next(err); }
});

/** Read-only SQL console (admin) — demonstrates SQL live during a viva. */
router.post('/sql', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!guard(res)) return;
    const result = await temporal.runReadOnlySql(req.body.sql, req.body.params || []);
    await logDbEvent('mongodb', 'admin.sql_console', `SQL console: ${String(req.body.sql).slice(0, 90)}`, { ms: result.ms });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
