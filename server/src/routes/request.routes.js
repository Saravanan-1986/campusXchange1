import express from 'express';
import Request from '../models/Request.js';
import Resource from '../models/Resource.js';
import { requireAuth } from '../middleware/auth.js';
import { syncRequestToGraph } from '../services/graph.service.js';

/** Requests — availability-alert subscriptions & exchange offers. */
const router = express.Router();

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { resourceId, type, message } = req.body;
    if (!['availability-alert', 'exchange-offer'].includes(type)) {
      return res.status(400).json({ message: 'Invalid request type' });
    }
    const resource = await Resource.findById(resourceId);
    if (!resource) return res.status(404).json({ message: 'Resource not found' });
    const req1 = await Request.create({ user: req.user._id, resource: resource._id, type, message });
    syncRequestToGraph(req.user._id, req.user.name, resource._id).catch(() => {});
    res.status(201).json({ request: req1 });
  } catch (err) { next(err); }
});

router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const requests = await Request.find({ user: req.user._id })
      .populate('resource', 'title availability price images')
      .sort({ createdAt: -1 }).lean();
    res.json({ requests });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const r = await Request.findOne({ _id: req.params.id, user: req.user._id });
    if (!r) return res.status(404).json({ message: 'Request not found' });
    r.status = 'cancelled';
    await r.save();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Owner view: requests on their listing
router.get('/resource/:resourceId', requireAuth, async (req, res, next) => {
  try {
    const resource = await Resource.findById(req.params.resourceId);
    if (!resource) return res.status(404).json({ message: 'Resource not found' });
    if (String(resource.ownerId) !== String(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not your listing' });
    }
    const requests = await Request.find({ resource: resource._id, status: 'open' })
      .populate('user', 'name department semester').sort({ createdAt: -1 }).lean();
    res.json({ requests });
  } catch (err) { next(err); }
});

export default router;
