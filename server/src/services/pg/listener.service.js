import mongoose from 'mongoose';
import { getListenerClient, pgStatus } from '../../config/pg.js';
import { drainOutbox } from './active.service.js';
import { notify } from '../notification.service.js';
import { logDbEvent } from '../eventlog.service.js';
import { emitDbEvent } from '../../sockets/index.js';

/**
 * ACTIVE DATABASE bridge — the API's half of the ECA loop.
 *
 * The database already finished the interesting part: a trigger evaluated the
 * condition and INSERTed an active_event row plus pg_notify('cx_active'). Here we
 * only *transport* it: LISTEN → drain the outbox with FOR UPDATE SKIP LOCKED →
 * write in-app notifications (MongoDB) → push over Socket.io (live toasts) →
 * append to the DB-event log shown in the admin monitor.
 *
 * No polling is required for the notification path; the cron safety net exists
 * only for the case where the listener connection drops.
 */
let listening = false;
let draining = false;
let drainTimer = null;
let delivered = 0;

const TYPE_MAP = [
  [/^resource\.available/, 'availability'],
  [/^resource\.price_changed/, 'price'],
  [/^resource\.owner_changed/, 'ownership'],
  [/^resource\.removed/, 'system'],
  [/^lend\.overdue/, 'overdue'],
  [/^lend\./, 'transaction'],
];

function notificationType(eventType) {
  const hit = TYPE_MAP.find(([re]) => re.test(eventType));
  return hit ? hit[1] : 'system';
}

/** Deliver one outbox row as notifications + a live admin monitor event. */
async function deliver(ev) {
  const type = notificationType(ev.event_type);
  const recipients = Array.isArray(ev.recipients) ? ev.recipients : [];

  // 1) in-app notifications for each addressed user (MongoDB is the inbox store)
  for (const recipientId of recipients) {
    if (!mongoose.isValidObjectId(recipientId)) continue;
    try {
      await notify({
        user: recipientId,
        type,
        title: ev.title,
        message: ev.message,
        link: ev.link || '',
        paradigm: 'active',
        extra: { pgEventId: String(ev.event_id), rule: ev.rule_id, entityType: ev.entity_type, entityId: ev.entity_id },
      });
    } catch (err) {
      console.error('[active-listener] notification write failed:', err.message);
    }
  }

  // 2) admin live feed (Socket.io db:event) — the monitor's streaming column
  try {
    const { emitDbEvent: emit } = await import('../../sockets/index.js');
    emit?.({
      _id: `pg-${ev.event_id}`,
      paradigm: 'active',
      type: ev.event_type,
      message: `[PG trigger ${ev.rule_id}] ${ev.title} — ${ev.message}`,
      payload: { rule: ev.rule_id, entityId: ev.entity_id, severity: ev.severity, recipients: recipients.length, source: ev.source },
      createdAt: ev.created_at,
    });
  } catch { /* sockets not ready yet */ }

  // 3) persistent DB-event log (also feeds REST refresh of the monitor)
  await logDbEvent('active', ev.event_type, `PostgreSQL trigger → ${ev.title}`, {
    rule: ev.rule_id, entityId: ev.entity_id, severity: ev.severity, recipients: recipients.length,
  });

  delivered += 1;
}

/** Claim and deliver pending outbox rows. Safe to call from many places. */
export async function deliverPending(limit = 40) {
  if (draining || pgStatus() !== 'connected') return { drained: 0 };
  draining = true;
  try {
    const events = await drainOutbox(limit);
    for (const ev of events) await deliver(ev);
    return { drained: events.length, delivered, last: events[0]?.event_type || null };
  } catch (err) {
    console.error('[active-listener] drain failed:', err.message);
    return { drained: 0, error: err.message };
  } finally {
    draining = false;
  }
}

function scheduleDrain(delay = 120) {
  if (drainTimer) return;
  drainTimer = setTimeout(async () => {
    drainTimer = null;
    await deliverPending();
  }, delay);
}

/** Attach to the database notification channel. */
export async function initActiveListener() {
  if (pgStatus() !== 'connected') {
    console.warn('[active-listener] PostgreSQL unavailable — trigger notifications disabled');
    return false;
  }
  try {
    const client = await getListenerClient();
    if (!listening) {
      client.on('notification', (msg) => {
        if (msg.channel === 'cx_active') scheduleDrain(120);
      });
      // If the connection dies, rebuild it (pg emits 'error' and the pool discards it).
      client.on('error', () => { listening = false; });
      await client.query('LISTEN cx_active');
      listening = true;
      console.log('[pg] LISTEN cx_active — trigger notifications stream to Socket.io');
    }
    const caught = await deliverPending(100); // anything queued while the API was down
    if (caught.drained) console.log(`[active-listener] delivered ${caught.drained} queued trigger event(s)`);
    return true;
  } catch (err) {
    console.error('[active-listener] init failed:', err.message);
    return false;
  }
}

export function listenerStatus() {
  return {
    listening,
    delivered,
    channel: 'cx_active',
    mode: listening ? 'listen-notify' : 'unavailable',
  };
}
