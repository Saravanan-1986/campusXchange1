import Resource from '../models/Resource.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import { recordResourceState } from './history.service.js';
import { syncResourceToGraph, syncTransferToGraph, syncListingStateToGraph } from './graph.service.js';
import { syncResourceToPostgres } from './pg/sync.service.js';
import { tagCustody } from './pg/temporal.service.js';
import { notify } from './notification.service.js';
import { logDbEvent } from './eventlog.service.js';

/**
 * HANDOVER / LISTING-STATE service — the bridge between the chat window and
 * every database in the stack.
 *
 *   transferResource → the item changes hands (chat /donate | /sell):
 *                      MongoDB owner moves + isListed=false, a ResourceHistory
 *                      version is written, PostgreSQL resource_mirror is updated
 *                      (whose triggers write resource_version + the next
 *                      custody_period + an ECA ownership-transfer event), and
 *                      Neo4j gains GAVE / RECEIVED / OWNS edges.
 *   unlistResource   → the owner pulls the item off the marketplace WITHOUT
 *                      giving it to anybody ("Remove from marketplace").
 *   relistResource   → the receiver re-lists what they got (sell / donate) so the
 *                      product keeps travelling; the custody chain grows.
 */
export const HANDOVER_MODES = ['sell', 'donate'];

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Owner (or admin) guard used by every handover / unlist / relist route. */
export function isOwnerOrAdmin(resource, user) {
  if (!resource || !user) return false;
  return String(resource.ownerId?._id || resource.ownerId) === String(user._id) || user.role === 'admin';
}

/**
 * Give the item to another student. Used by the chat commands (/donate, /sell)
 * and by POST /api/resources/:id/transfer.
 */
export async function transferResource({
  resourceId, toUserId, mode = 'donate', price = null, actor, conversationId = null, note = '',
}) {
  const handoverMode = HANDOVER_MODES.includes(mode) ? mode : 'donate';
  const resource = await Resource.findById(resourceId).populate('ownerId', 'name');
  if (!resource) throw fail('Resource not found', 404);
  if (!isOwnerOrAdmin(resource, actor)) throw fail('Only the current owner can hand this item over', 403);

  const fromUser = resource.ownerId;
  const toUser = await User.findById(toUserId);
  if (!toUser) throw fail('That student no longer exists', 404);
  if (String(fromUser._id) === String(toUser._id)) throw fail('That student already owns this item');

  const sellPrice = handoverMode === 'sell'
    ? Math.max(0, Number(price ?? resource.price) || 0)
    : 0;

  // ---- MongoDB: the item keeps its identity and moves to the receiver -------
  resource.ownerId = toUser._id;
  resource.isListed = false;            // off the marketplace the moment it is given
  resource.availability = 'available';  // the receiver may re-list it right away
  resource.listingType = handoverMode;
  resource.price = sellPrice;
  resource.receivedFrom = fromUser._id;
  resource.receivedAt = new Date();
  resource.receivedVia = handoverMode;
  resource.transferCount = Number(resource.transferCount || 0) + 1;
  await resource.save();

  return settleHandover({ resource, fromUser, toUser, actor, handoverMode, sellPrice, conversationId, note });
}

/**
 * Fan the handover out to the other engines. Kept separate so the Mongo write
 * and the cross-database mirroring read as two distinct steps.
 */
async function settleHandover({ resource, fromUser, toUser, actor, handoverMode, sellPrice, conversationId, note }) {
  // ---- TEMPORAL: Mongo snapshot + PG mirror. The mirror update fires the PG
  //      triggers that write resource_version and the next custody_period. -----
  await recordResourceState(resource, {
    actorLabel: actor.name,
    source: 'user',
    fields: ['ownerId', 'isListed', 'availability', 'listingType', 'price'],
    summary: `${handoverMode === 'donate' ? 'Donated' : 'Sold'} to ${toUser.name}`
      + `${sellPrice ? ` for ₹${sellPrice}` : ''} · handover #${resource.transferCount}`,
  });
  await syncResourceToPostgres(resource, {
    actorLabel: actor.name,
    reason: `${handoverMode} handover → ${toUser.name}`,
  });
  await tagCustody(resource._id, handoverMode,
    note || `${handoverMode} handover from ${fromUser.name} to ${toUser.name}`
      + `${conversationId ? ` (chat ${String(conversationId).slice(-6)})` : ''}`);

  // ---- GRAPH: the handover becomes a first-class edge ------------------------
  await syncResourceToGraph(resource, toUser.name);
  await syncTransferToGraph({
    fromUserId: fromUser._id,
    toUserId: toUser._id,
    resourceId: resource._id,
    mode: handoverMode,
    price: sellPrice,
  });

  // ---- Deal record (dashboard deals tracker + analytics) ---------------------
  const transaction = await Transaction.create({
    resource: resource._id,
    owner: fromUser._id,
    borrower: toUser._id,
    type: handoverMode,
    price: sellPrice,
    status: 'completed',
    message: String(note || '').slice(0, 400),
  });

  // ---- ACTIVE layer: tell the receiver ---------------------------------------
  await notify({
    user: toUser._id,
    type: 'deal',
    title: handoverMode === 'donate' ? '🎁 An item was donated to you' : '🤝 An item was sold to you',
    message: `"${resource.title}" came from ${fromUser.name}${sellPrice ? ` for ₹${sellPrice}` : ''}. Re-list it from Items received whenever you like.`,
    link: '/items-received',
    paradigm: 'graph',
    extra: {
      resourceId: String(resource._id),
      conversationId: conversationId ? String(conversationId) : null,
      mode: handoverMode,
    },
  });
  await logDbEvent('graph', 'handover.completed',
    `${fromUser.name} → ${toUser.name}: "${resource.title}" (${handoverMode}${sellPrice ? ` ₹${sellPrice}` : ''})`,
    { resourceId: String(resource._id), transferCount: resource.transferCount });

  return { resource, fromUser, toUser, transaction, mode: handoverMode, price: sellPrice };
}

/**
 * Remove the item from the marketplace WITHOUT handing it to anyone — the owner
 * keeps it. Powers the "Remove from marketplace" button in the chat window and
 * on the listing page.
 */
export async function unlistResource({ resourceId, actor, note = '' }) {
  const resource = await Resource.findById(resourceId).populate('ownerId', 'name');
  if (!resource) throw fail('Resource not found', 404);
  if (!isOwnerOrAdmin(resource, actor)) throw fail('Only the current owner can remove this listing', 403);
  if (resource.isListed === false && resource.availability === 'unavailable') {
    return { resource, alreadyUnlisted: true };
  }

  resource.isListed = false;
  resource.availability = 'unavailable';
  await resource.save();

  await recordResourceState(resource, {
    actorLabel: actor.name,
    source: 'user',
    fields: ['isListed', 'availability'],
    summary: 'Removed from the marketplace (kept by the owner)',
  });
  await syncResourceToPostgres(resource, { actorLabel: actor.name, reason: 'Removed from marketplace' });
  await tagCustody(resource._id, 'unlisted', note || `Removed from the marketplace by ${actor.name}`);
  await syncResourceToGraph(resource, resource.ownerId?.name || '');
  await logDbEvent('mongodb', 'listing.unlisted', `"${resource.title}" removed from the marketplace`, {
    resourceId: String(resource._id), by: actor.name,
  });

  return { resource, alreadyUnlisted: false };
}

/**
 * Put an item you own back on the marketplace as a sell or donate listing —
 * this is what makes a received product travel on (and lengthens the chain).
 */
export async function relistResource({ resourceId, actor, listingType = 'donate', price = null, title, description }) {
  const mode = HANDOVER_MODES.includes(listingType) ? listingType : 'donate';
  const resource = await Resource.findById(resourceId).populate('ownerId', 'name');
  if (!resource) throw fail('Resource not found', 404);
  if (!isOwnerOrAdmin(resource, actor)) throw fail('Only the current owner can re-list this item', 403);

  const changed = [];
  if (resource.isListed === false) { resource.isListed = true; changed.push('isListed'); }
  if (resource.availability !== 'available') { resource.availability = 'available'; changed.push('availability'); }
  if (resource.listingType !== mode) { resource.listingType = mode; changed.push('listingType'); }
  const newPrice = mode === 'sell' ? Math.max(0, Number(price ?? resource.price) || 0) : 0;
  if (Number(resource.price) !== newPrice) { resource.price = newPrice; changed.push('price'); }
  if (title && title !== resource.title) { resource.title = title; changed.push('title'); }
  if (description !== undefined && description !== resource.description) {
    resource.description = description; changed.push('description');
  }
  await resource.save();

  const reListed = changed.length > 0;
  if (reListed) {
    await recordResourceState(resource, {
      actorLabel: actor.name,
      source: 'user',
      fields: changed,
      summary: `Re-listed on the marketplace as ${mode}${newPrice ? ` (₹${newPrice})` : ''}`,
    });
    await syncResourceToPostgres(resource, { actorLabel: actor.name, reason: `Re-listed as ${mode}` });
    await tagCustody(resource._id, 'relisted', `Re-listed as ${mode} by ${actor.name}`);
    await syncResourceToGraph(resource, resource.ownerId?.name || '');
    await logDbEvent('mongodb', 'listing.relisted', `"${resource.title}" re-listed as ${mode}`, {
      resourceId: String(resource._id), by: actor.name,
    });
  }
  return { resource, mode, reListed, changed };
}

export default { transferResource, unlistResource, relistResource, isOwnerOrAdmin };

