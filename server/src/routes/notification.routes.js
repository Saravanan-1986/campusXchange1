import express from 'express';
import Notification from '../models/Notification.js';
import { requireAuth } from '../middleware/auth.js';

/** Notifications — the inbox of the Active DB automation + user activity. */
const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { limit = 30, unreadOnly } = req.query;
    const filter = { user: req.user._id };
    if (unreadOnly === 'true') filter.read = false;
    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 }).limit(Number(limit)).lean();
    const unreadCount = await Notification.countDocuments({ user: req.user._id, read: false });
    res.json({ notifications, unreadCount });
  } catch (err) { next(err); }
});

router.post('/mark-all-read', requireAuth, async (req, res, next) => {
  try {
    await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/read', requireAuth, async (req, res, next) => {
  try {
    await Notification.updateOne({ _id: req.params.id, user: req.user._id }, { read: true });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
