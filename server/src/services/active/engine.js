import Request from '../../models/Request.js';
import Notification from '../../models/Notification.js';
import User from '../../models/User.js';
import { env } from '../../config/env.js';
import { notify } from '../notification.service.js';
import { logDbEvent } from '../eventlog.service.js';

/**
 * ACTIVE DB PARADIGM — Event-Condition-Action (ECA) rules engine.
 *
 * Events are fired by MongoDB Change Streams (availability/transaction changes),
 * report creation, and node-cron jobs. Each rule declares:
 *   on(event)     → which events it listens to
 *   condition(ev) → boolean predicate (evaluated when event fires)
 *   action(ev)    → the side effect (notification write + Socket.io push + flag)
 *
 * Every firing is recorded to the DbEvent log for the admin monitor.
 */
export const rules = [
  {
    name: 'notify-on-availability',
    description: 'When a resource becomes available, notify all open availability-alert requesters.',
    on: ['resource.updated'],
    async condition(ev) {
      return ev.after?.availability === 'available' && ev.before && ev.before.availability !== 'available';
    },
    async action(ev) {
      const subs = await Request.find({ resource: ev.after._id, type: 'availability-alert', status: 'open' })
        .populate('user', 'name');
      for (const r of subs) {
        await notify({
          user: r.user._id,
          type: 'availability',
          title: 'Resource back in stock!',
          message: `"${ev.after.title}" you're watching is now ${ev.after.availability}.`,
          link: `/resources/${ev.after._id}`,
          paradigm: 'active',
          extra: { rule: 'notify-on-availability' },
        });
        await Request.updateOne({ _id: r._id }, { status: 'fulfilled' });
      }
      await logDbEvent('active', 'eca.rule.fired',
        `notify-on-availability → ${subs.length} student(s) notified`, { resource: String(ev.after._id) });
    },
  },
  {
    name: 'transaction-lifecycle-notify',
    description: 'Auto-update resource availability post-transaction and notify both parties.',
    on: ['transaction.updated'],
    async condition(ev) {
      return ['accepted', 'completed', 'rejected', 'returned'].includes(ev.after?.status) &&
        ev.before && ev.before.status !== ev.after.status;
    },
    async action(ev) {
      const t = ev.after;
      const titleMap = {
        accepted: 'Request accepted ✅',
        completed: 'Deal completed 🎉',
        rejected: 'Request rejected',
        returned: 'Lend item returned 📦',
      };
      for (const uid of [t.owner, t.borrower?._id || t.borrower]) {
        await notify({
          user: uid,
          type: 'transaction',
          title: titleMap[t.status] || `Transaction ${t.status}`,
          message: `"${t.resource?.title || 'a resource'}" — status: ${t.status}.`,
          link: `/transactions/${t._id}`,
          paradigm: 'active',
          extra: { rule: 'transaction-lifecycle-notify', txId: String(t._id) },
        });
      }
      await logDbEvent('active', 'eca.rule.fired',
        `transaction-lifecycle-notify → status=${t.status}`, { txId: String(t._id) });
    },
  },
  {
    name: 'report-auto-flag',
    description: `When a target accumulates ≥ ${env.reportAutoFlagThreshold} open reports, auto-flag it and alert admins.`,
    on: ['report.created'],
    async condition(ev) {
      return ev.reportsCount >= env.reportAutoFlagThreshold && ev.targetType === 'resource';
    },
    async action(ev) {
      await Resource.updateOne({ _id: ev.targetId }, { availability: 'flagged', flagged: true });
      const admins = await User.find({ role: 'admin' });
      for (const a of admins) {
        await notify({
          user: a._id,
          type: 'report',
          title: '🚩 Resource auto-flagged',
          message: `Resource ${ev.targetId} hit ${ev.reportsCount} reports and was auto-flagged by an ECA rule.`,
          link: '/admin',
          paradigm: 'active',
          extra: { rule: 'report-auto-flag' },
        });
      }
      await logDbEvent('active', 'eca.rule.fired',
        `report-auto-flag → resource ${ev.targetId} flagged (${ev.reportsCount} reports)`, {});
    },
  },
];

/** Fire an event into the rules engine. Returns number of rules that acted. */
export async function fireEvent(type, payload) {
  let fired = 0;
  for (const rule of rules) {
    if (!rule.on.includes(type)) continue;
    try {
      if (await rule.condition(payload)) {
        fired++;
        await rule.action(payload);
      }
    } catch (err) {
      console.error(`[active] rule ${rule.name} failed:`, err.message);
      await logDbEvent('active', 'eca.rule.error', `${rule.name}: ${err.message}`, {});
    }
  }
  return fired;
}

export function listRules() {
  return rules.map((r) => ({
    name: r.name, description: r.description, on: r.on,
    conditions: r.condition.toString().slice(0, 220),
  }));
}
