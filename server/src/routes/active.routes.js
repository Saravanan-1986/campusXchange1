import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as active from '../services/pg/active.service.js';
import { deliverPending, listenerStatus } from '../services/pg/listener.service.js';
import { pgStatus } from '../config/pg.js';
import { logDbEvent } from '../services/eventlog.service.js';

/**
 * ACTIVE DATABASE endpoints — everything the PostgreSQL triggers produced.
 * The API never decides what to notify; it exposes (and delivers) the database's
 * own decisions: active_event outbox, ECA rule registry, pg_catalog introspection.
 */
const router = express.Router();

function guard(res) {
  if (pgStatus() !== 'connected') {
    res.status(503).json({ message: 'PostgreSQL active layer unavailable — run `npm run db:migrate`' });
    return false;
  }
  return true;
}

// --- public-ish reads -------------------------------------------------------
router.get('/status', (req, res) => res.json({ postgres: pgStatus(), listener: listenerStatus() }));

router.get('/rules', requireAuth, async (req, res, next) => {
  try {
    if (!guard(res)) return;
    res.json({ source: 'postgresql', table: 'active_rule', rules: await active.listRules() });
  } catch (err) { next(err); }
});

router.get('/events', requireAuth, async (req, res, next) => {
  try {
    if (!guard(res)) return;
    const events = await active.listEvents({
      limit: req.query.limit, status: req.query.status,
      entityType: req.query.entityType, entityId: req.query.entityId,
    });
    res.json({ source: 'postgresql', table: 'active_event', events });
  } catch (err) { next(err); }
});

router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    if (!guard(res)) return;
    const [stats, listener] = await Promise.all([active.stats(), listenerStatus()]);
    res.json({ source: 'postgresql', stats, listener });
  } catch (err) { next(err); }
});

// --- admin: introspection of PostgreSQL itself -----------------------------
router.get('/introspect', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!guard(res)) return;
    const [internals, triggers, tables, indexes] = await Promise.all([
      active.internals(), active.triggerCatalog(), active.tableStats(), active.indexUsage(),
    ]);
    res.json({ source: 'postgresql', internals, triggers, tables, indexes });
  } catch (err) { next(err); }
});

router.patch('/rules/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!guard(res)) return;
    const rule = await active.toggleRule(req.params.id, req.body.enabled !== false);
    await logDbEvent('active', 'rule.toggled', `ECA rule ${rule.rule_id} → ${rule.enabled ? 'armed' : 'disabled'}`, {});
    res.json({ rule });
  } catch (err) { next(err); }
});

// --- admin: manual deliveries / demos -------------------------------------
router.post('/drain', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!guard(res)) return;
    const result = await deliverPending(Number(req.body.limit) || 40);
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * Fire a change straight into the mirror table — proving the DATABASE reacts
 * (not the API): UPDATE → trigger → active_event → pg_notify → Socket.io toast.
 */
router.post('/demo/price-drop', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!guard(res)) return;
    const { resourceId, price } = req.body;
    const updated = await active.pokePrice(resourceId, price);
    const result = await deliverPending(20);
    await logDbEvent('active', 'demo.price_drop', `Direct SQL price update on ${resourceId} → trigger fired`, updated);
    res.json({ ok: true, updated, delivered: result });
  } catch (err) { next(err); }
});

router.post('/demo/availability', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!guard(res)) return;
    const { resourceId, availability = 'available' } = req.body;
    const updated = await active.pokeAvailability(resourceId, availability);
    const result = await deliverPending(20);
    await logDbEvent('active', 'demo.availability', `Direct SQL availability update on ${resourceId} → trigger fired`, updated);
    res.json({ ok: true, updated, delivered: result });
  } catch (err) { next(err); }
});

export default router;
