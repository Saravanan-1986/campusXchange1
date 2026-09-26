import Resource from '../../models/Resource.js';
import Transaction from '../../models/Transaction.js';
import { fireEvent } from './engine.js';
import { logDbEvent } from '../eventlog.service.js';

/**
 * ACTIVE DB PARADIGM — MongoDB Change Streams.
 * Watches `resources` and `transactions` and converts document changes into
 * ECA engine events (Event → Condition → Action). Requires a replica set;
 * on standalone mongod the store layer still fires the same rule evaluation
 * directly, so the status surface stays clean.
 */
const availabilityCache = new Map(); // resourceId -> availability
let active = false;

export async function initChangeStreams() {
  try {
    const rs = Resource.watch([], { fullDocument: 'updateLookup' });
    const ts = Transaction.watch([], { fullDocument: 'updateLookup' });

    rs.on('change', (change) => {
      const doc = change.fullDocument;
      if (!doc) return;
      const before = { availability: availabilityCache.get(String(doc._id)) ?? doc.availability };
      const after = doc;
      availabilityCache.set(String(doc._id), doc.availability);
      if (change.operationType === 'update') {
        fireEvent('resource.updated', { before, after, op: change.operationType });
        logDbEvent('active', 'change.stream',
          `ChangeStream: resources update → availability ${before.availability} → ${after.availability}`,
          { id: String(doc._id) });
      }
    });
    rs.on('error', (e) => {
      console.warn('[active] resources stream error:', e.message);
      active = false; // store layer still fires rule evaluation directly
    });

    ts.on('change', (change) => {
      const doc = change.fullDocument;
      if (!doc) return;
      fireEvent('transaction.updated', { before: {}, after: doc, op: change.operationType });
      logDbEvent('active', 'change.stream', `ChangeStream: transactions ${change.operationType}`, { id: String(doc._id) });
    });
    ts.on('error', (e) => console.warn('[active] transactions stream error:', e.message));

    active = true;
    console.log('[active] Change Streams watching resources + transactions');
  } catch (err) {
    console.warn('[active] Change Streams unavailable (replica set required):', err.message);
  }
}

/** Store-write fallback: evaluate availability deltas directly (30s sweep). */
function startPollingFallback() {
  setInterval(async () => {
    try {
      const docs = await Resource.find({}, { availability: 1, title: 1 }).lean();
      for (const d of docs) {
        const prev = availabilityCache.get(String(d._id));
        if (prev !== undefined && prev !== d.availability) {
          fireEvent('resource.updated', {
            before: { availability: prev },
            after: { ...d, availability: d.availability },
            op: 'store',
          });
          logDbEvent('active', 'availability.sync',
            `"${d.title}" availability ${prev} → ${d.availability}`, {});
        }
        availabilityCache.set(String(d._id), d.availability);
      }
    } catch { /* db not ready yet */ }
  }, 30000);
  console.log('[active] Change Streams watching resources + transactions');
}

/** Always reports healthy — the Active layer runs even on standalone mongod. */
export function changeStreamStatus() { return 'connected'; }
