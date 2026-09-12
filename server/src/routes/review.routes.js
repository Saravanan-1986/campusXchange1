import express from 'express';
import Review from '../models/Review.js';
import { requireAuth } from '../middleware/auth.js';
import { syncReviewToGraph } from '../services/graph.service.js';
import { logDbEvent } from '../services/eventlog.service.js';

/** Reviews & ratings — for both resources and materials. */
const router = express.Router();

router.get('/:targetType/:targetId', async (req, res, next) => {
  try {
    const { targetType, targetId } = req.params;
    if (!['resource', 'material'].includes(targetType)) return res.status(400).json({ message: 'Invalid target type' });
    const reviews = await Review.find({ targetType, targetId })
      .populate('user', 'name department').sort({ createdAt: -1 }).lean();
    res.json({ reviews });
  } catch (err) { next(err); }
});

// Create/update own review (upsert per user+target)
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { targetType, targetId, rating, comment } = req.body;
    if (!['resource', 'material'].includes(targetType)) return res.status(400).json({ message: 'Invalid target type' });
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ message: 'Rating must be 1-5' });
    const review = await Review.findOneAndUpdate(
      { targetType, targetId, user: req.user._id },
      { rating, comment: comment || '' },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    const agg = await Review.syncAggregates(targetType, targetId);
    if (targetType === 'resource') syncReviewToGraph(req.user._id, req.user.name, targetId, rating).catch(() => {});
    await logDbEvent('graph', 'review.sync', `${req.user.name} rated ${targetType} ${rating}★`, { targetId: String(targetId) });
    res.status(201).json({ review, aggregates: agg });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const review = await Review.findOne({ _id: req.params.id, user: req.user._id });
    if (!review) return res.status(404).json({ message: 'Review not found' });
    await review.deleteOne();
    await Review.syncAggregates(review.targetType, review.targetId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
