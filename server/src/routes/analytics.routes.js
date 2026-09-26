import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as analytics from '../services/pg/analytics.service.js';
import { pgStatus } from '../config/pg.js';
import { logDbEvent } from '../services/eventlog.service.js';

/**
 * SQL ANALYTICS endpoints (PostgreSQL) — the reporting side of CampusXchange.
 * Aggregates · window functions (RANK, LAG, running totals) · percentiles ·
 * generate_series trends · width_bucket histograms · a materialized view.
 */
const router = express.Router();

function guard(res) {
  if (pgStatus() !== 'connected') {
    res.status(503).json({ message: 'PostgreSQL analytics unavailable — run `npm run db:migrate`' });
    return false;
  }
  return true;
}

router.get('/overview', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!guard(res)) return;
    const data = await analytics.overview();
    await logDbEvent('mongodb', 'analytics.overview', `SQL analytics: ${data.kpis.listings} listings · ${data.kpis.versionsRecorded} versions`, {});
    res.json({ source: 'postgresql', ...data });
  } catch (err) { next(err); }
});

router.get('/trend', requireAuth, async (req, res, next) => {
  try {
    if (!guard(res)) return;
    res.json({ source: 'postgresql', sql: 'cx_listing_trend(days)', trend: await analytics.trend(req.query.days) });
  } catch (err) { next(err); }
});

router.get('/lenders', requireAuth, async (req, res, next) => {
  try {
    if (!guard(res)) return;
    res.json({ source: 'postgresql', sql: 'cx_top_lenders() — RANK() + running total', lenders: await analytics.topLenders(req.query.limit) });
  } catch (err) { next(err); }
});

router.get('/prices', requireAuth, async (req, res, next) => {
  try {
    if (!guard(res)) return;
    const [stats, bands] = await Promise.all([analytics.priceStats(), analytics.priceBands(req.query.buckets)]);
    res.json({ source: 'postgresql', sql: 'cx_price_stats() · cx_price_bands() — percentile_cont + width_bucket', stats, bands });
  } catch (err) { next(err); }
});

router.get('/most-changed', requireAuth, async (req, res, next) => {
  try {
    if (!guard(res)) return;
    res.json({ source: 'postgresql', sql: 'cx_most_changed_resources() — temporal × active join', resources: await analytics.mostChanged(req.query.limit) });
  } catch (err) { next(err); }
});

router.get('/categories', requireAuth, async (req, res, next) => {
  try {
    if (!guard(res)) return;
    res.json({ source: 'postgresql', sql: 'mv_campus_activity (materialized view)', categories: await analytics.categories() });
  } catch (err) { next(err); }
});

router.post('/refresh', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!guard(res)) return;
    const r = await analytics.refresh();
    await logDbEvent('mongodb', 'analytics.refresh', 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_campus_activity', {});
    res.json({ ok: true, refreshedAt: r?.refreshed_at });
  } catch (err) { next(err); }
});

export default router;
