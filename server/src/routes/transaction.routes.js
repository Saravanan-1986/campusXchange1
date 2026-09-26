import express from 'express';
import Transaction from '../models/Transaction.js';
import Resource from '../models/Resource.js';
import { requireAuth } from '../middleware/auth.js';
import { recordResourceState } from '../services/history.service.js';
import { syncUsedToGraph } from '../services/graph.service.js';
import { syncResourceToPostgres, syncTransactionToPostgres } from '../services/pg/sync.service.js';
import { recordLendPeriod, closeLendPeriod } from '../services/pg/temporal.service.js';
import { fireEvent } from '../services/active/engine.js';
import { openThread, sendThreadMessage } from '../services/chat.service.js';
import { logDbEvent } from '../services/eventlog.service.js';

/**
 * Transactions — buy/donate/exchange/lend deals between students.
 * TEMPORAL: accept/complete/return transitions are written to ResourceHistory.
 * ACTIVE: status changes fire ECA events (notify both parties).
 * GRAPH: completed deals create Student-[:USED]->Resource edges.
 */
const router = express.Router();

// Create a deal request (borrower side)
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { resourceId, message, dueDate } = req.body;
    const resource = await Resource.findById(resourceId);
    if (!resource) return res.status(404).json({ message: 'Resource not found' });
    if (String(resource.ownerId) === String(req.user._id)) {
      return res.status(400).json({ message: 'You own this resource' });
    }
    if (resource.availability !== 'available') {
      return res.status(400).json({ message: `Resource is currently ${resource.availability}` });
    }
    const tx = await Transaction.create({
      resource: resource._id, owner: resource.ownerId, borrower: req.user._id,
      type: resource.listingType, price: resource.price,
      dueDate: resource.listingType === 'lend' && dueDate ? new Date(dueDate) : undefined,
      message,
    });
    await logDbEvent('mongodb', 'tx.requested', `${req.user.name} requested "${resource.title}"`, { txId: String(tx._id) });
    await syncTransactionToPostgres(tx);

    // Wish-to-buy/lend handshake: a chat window opens between seller & buyer,
    // linked to this listing + deal, seeded with the buyer's request note.
    let conversationId = null;
    try {
      const convo = await openThread({
        meId: req.user._id, peerId: resource.ownerId,
        resourceId: resource._id, transactionId: tx._id,
        subject: `Deal: ${resource.title}`,
      });
      conversationId = String(convo._id);
      const note = String(message || '').trim() || `Hi! I'd like to ${resource.listingType} "${resource.title}".`;
      await sendThreadMessage({ conversation: convo, me: req.user, peerId: resource.ownerId, body: note });
    } catch (err) {
      console.warn('[chat] auto-thread notice:', err.message);
    }
    res.status(201).json({ transaction: tx, conversationId });

  } catch (err) { next(err); }
});

// My deals (incoming + outgoing)
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const incoming = await Transaction.find({ owner: req.user._id })
      .populate('resource borrower', 'title images name condition').sort({ createdAt: -1 }).lean();
    const outgoing = await Transaction.find({ borrower: req.user._id })
      .populate('resource owner', 'title images name condition').sort({ createdAt: -1 }).lean();
    res.json({ incoming, outgoing });
  } catch (err) { next(err); }
});

// Status transitions
router.patch('/:id/status', requireAuth, async (req, res, next) => {
  try {
    const { status } = req.body;
    const allowed = ['accepted', 'rejected', 'completed', 'returned'];
    if (!allowed.includes(status)) return res.status(400).json({ message: 'Invalid status' });
    const tx = await Transaction.findById(req.params.id).populate('resource', 'title listingType');
    if (!tx) return res.status(404).json({ message: 'Transaction not found' });

    const isOwner = String(tx.owner) === String(req.user._id);
    const isBorrower = String(tx.borrower) === String(req.user._id);
    if (['accepted', 'rejected'].includes(status) && !isOwner) {
      return res.status(403).json({ message: 'Only the owner can accept/reject' });
    }
    if (['completed', 'returned'].includes(status) && !isBorrower) {
      return res.status(403).json({ message: 'Only the requester can complete/return' });
    }

    const before = tx.toObject();
    tx.status = status;
    if (status === 'completed' && tx.type === 'lend') { /* completed only for one-shot deals */ }
    if (status === 'returned') tx.returnedAt = new Date();
    await tx.save();

    // Resource lifecycle updates (TEMPORAL + availability automation)
    const resource = await Resource.findById(tx.resource._id).populate('ownerId', 'name');
    if (status === 'accepted' && tx.type === 'lend') {
      resource.availability = 'lent';
      await resource.save();
      await recordResourceState(resource, { actorLabel: 'system:transaction', source: 'automation', fields: ['availability'], summary: 'Lent out (lend cycle start)' });
      await syncResourceToPostgres(resource, { actorLabel: 'system:transaction', reason: 'Lent out — lend period opened' });
      // GiST exclusion constraint guards double-lending in PG
      try {
        await recordLendPeriod({
          resourceId: resource._id,
          borrowerId: tx.borrower,
          borrowerLabel: req.user.name,
          lendStart: new Date(),
          lendEnd: tx.dueDate || null,
        });
      } catch (err) {
        console.warn('[temporal] recordLendPeriod notice:', err.message);
      }
    }
    if (status === 'completed' && ['sell', 'exchange', 'donate'].includes(tx.type)) {
      resource.availability = 'unavailable';
      if (tx.type === 'sell') resource.ownerId = tx.borrower; // ownership transfer
      await resource.save();
      await recordResourceState(resource, {
        actorLabel: 'system:transaction', source: 'automation', fields: ['availability', 'ownerId'],
        summary: `Ownership transferred via ${tx.type} (viva: temporal owner change)`,
      });
      await syncResourceToPostgres(resource, {
        actorLabel: 'system:transaction',
        reason: `Ownership transferred via ${tx.type}`,
      });
      await syncUsedToGraph(tx.borrower, tx.resource._id);
    }
    if (status === 'returned') {
      resource.availability = 'available';
      await resource.save();
      await recordResourceState(resource, { actorLabel: 'system:transaction', source: 'automation', fields: ['availability'], summary: 'Returned — lend cycle closed' });
      await syncResourceToPostgres(resource, { actorLabel: 'system:transaction', reason: 'Returned — lend cycle closed' });
      try {
        await closeLendPeriod(resource._id, tx.borrower, new Date());
      } catch (err) {
        console.warn('[temporal] closeLendPeriod notice:', err.message);
      }
    }

    await syncTransactionToPostgres(tx);


    const after = tx.toObject();
    after.resource = tx.resource;
    await fireEvent('transaction.updated', { before, after });
    res.json({ transaction: tx });
  } catch (err) { next(err); }
});

export default router;
