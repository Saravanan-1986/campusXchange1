import ResourceHistory from '../models/ResourceHistory.js';
import { logDbEvent } from './eventlog.service.js';

/**
 * TEMPORAL PARADIGM service.
 * Writes bi-temporal (valid time + transaction time) versioned snapshots of a
 * resource on every state change, using the validFrom/validTo interval pattern.
 * Owner names are stored anonymized so public timelines never leak identities.
 */
function maskName(name = '') {
  if (!name) return 'unknown';
  const parts = name.trim().split(/\s+/);
  return parts.map((p) => p[0] + '***').join(' ');
}

function snapshotOf(resource, ownerName) {
  return {
    title: resource.title,
    price: resource.price,
    condition: resource.condition,
    listingType: resource.listingType,
    availability: resource.availability,
    ownerId: resource.ownerId,
    ownerName: maskName(ownerName),
    category: resource.category,
    subject: resource.subject || '',
  };
}

/**
 * Record a new version: closes the current open interval (validTo=now),
 * inserts a fresh snapshot (validFrom=now, validTo=null).
 * Call after ANY resource mutation — CRUD, lend/return, automation.
 */
export async function recordResourceState(resource, { actorLabel = 'user', source = 'user', fields = [], summary = '' } = {}) {
  try {
    let ownerName = '';
    if (resource.populated?.('ownerId')) ownerName = resource.ownerId.name;
    else if (typeof resource.ownerId === 'object') ownerName = resource.ownerId.name || '';

    const last = await ResourceHistory.findOne({ resource: resource._id }).sort({ version: -1 });
    if (last && last.validTo == null) {
      last.validTo = new Date();
      await last.save(); // close valid-time interval (temporal pattern)
    }
    const doc = await ResourceHistory.create({
      resource: resource._id,
      version: (last?.version || 0) + 1,
      validFrom: new Date(),
      validTo: null,
      recordedAt: new Date(),
      source,
      actorLabel,
      snapshot: snapshotOf(resource, ownerName),
      change: { fields, summary: summary || (fields.length ? `changed: ${fields.join(', ')}` : 'initial record') },
    });
    await logDbEvent('temporal', 'history.version', `v${doc.version} — ${doc.change.summary}`, {
      resource: String(resource._id),
      validFrom: doc.validFrom,
    });
    return doc;
  } catch (err) {
    console.error('[temporal] recordResourceState failed:', err.message);
    return null;
  }
}

/** Reconstruct the full lifecycle timeline (oldest → newest). */
export async function getResourceTimeline(resourceId) {
  return ResourceHistory.find({ resource: resourceId }).sort({ validFrom: 1 }).lean();
}
