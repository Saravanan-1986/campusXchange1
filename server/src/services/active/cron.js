import cron from 'node-cron';
import Transaction from '../../models/Transaction.js';
import { notify } from '../notification.service.js';
import { fireEvent } from './engine.js';
import { logDbEvent } from '../eventlog.service.js';

/**
 * ACTIVE DB PARADIGM — scheduled triggers (node-cron).
 * 1. Overdue check (every minute): lend transactions past their due date are
 *    marked overdue; owner + borrower get reminded (ECA-style notify).
 * 2. Heartbeat (every 10 min): proves cron liveness on the admin monitor.
 */
export function initCron() {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const overdue = await Transaction.find({
        type: 'lend', status: 'accepted', dueDate: { $lt: now },
      }).populate('owner borrower resource').lean();
      for (const t of overdue) {
        if (t.returnedAt) continue;
        await Transaction.updateOne({ _id: t._id }, { status: 'overdue' });
        for (const uid of [t.owner._id, t.borrower._id]) {
          await notify({
            user: uid,
            type: 'overdue',
            title: '⏰ Overdue reminder',
            message: `"${t.resource.title}" is past its due date (${t.dueDate.toLocaleDateString()}). Please arrange a return.`,
            link: `/resources/${t.resource._id}`,
            paradigm: 'active',
            extra: { txId: String(t._id), cron: 'overdue-check' },
          });
        }
        fireEvent('transaction.updated', { before: { status: 'accepted' }, after: { ...t, status: 'overdue' } });
        await logDbEvent('active', 'cron.overdue', `Overdue check: tx ${t._id} marked overdue`, {});
      }
    } catch (err) { console.error('[cron] overdue job failed:', err.message); }
  });

  cron.schedule('*/10 * * * *', async () => {
    await logDbEvent('active', 'cron.heartbeat', 'Cron heartbeat — scheduler alive', { at: new Date().toISOString() });
  });

  console.log('[active] node-cron jobs scheduled (overdue check every min, heartbeat every 10 min)');
}
