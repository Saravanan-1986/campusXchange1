import express from 'express';
import Report from '../models/Report.js';
import Resource from '../models/Resource.js';
import { mongoStatus } from '../config/db.js';
import { neo4jStatus } from '../services/graph.service.js';
import { changeStreamStatus } from '../services/active/changeStreams.js';
import { listRules } from '../services/active/engine.js';
import DbEvent from '../models/DbEvent.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

/**
 * ADMIN — DB Technology Monitor + reports queue + user management.
 * The monitor is the viva centerpiece: it shows live events from all five
 * database paradigms, streamed over Socket.io (db:event) to the admin panel.
 */
const router = express.Router();
router.use(requireAuth, requireRole('admin'));

// Live monitor snapshot (REST baseline; live deltas arrive via Socket.io)
router.get('/monitor', async (req, res, next) => {
  try {
    const events = await DbEvent.find().sort({ createdAt: -1 }).limit(60).lean();
    const counts = await DbEvent.aggregate([
      { $group: { _id: '$paradigm', count: { $sum: 1 } } },
    ]);
    res.json({
      events,
      counts: Object.fromEntries(counts.map((c) => [c._id, c.count])),
      status: {
        mongodb: mongoStatus(),
        graph: neo4jStatus(),
        activeChangeStreams: changeStreamStatus(),
        activeRules: listRules(),
      },
    });
  } catch (err) { next(err); }
});

// Reports queue
router.get('/reports', async (req, res, next) => {
  try {
    const reports = await Report.find().sort({ createdAt: -1 }).limit(100)
      .populate('reporter', 'name collegeEmail').lean();
    res.json({ reports });
  } catch (err) { next(err); }
});

router.patch('/reports/:id', async (req, res, next) => {
  try {
    const { status } = req.body; // resolved | dismissed
    if (!['resolved', 'dismissed'].includes(status)) return res.status(400).json({ message: 'Invalid status' });
    const report = await Report.findByIdAndUpdate(req.params.id, { status }, { new: true });
    // Un-flag resource when all its reports are handled
    if (report.targetType === 'resource') {
      const open = await Report.countDocuments({ targetType: 'resource', targetId: report.targetId, status: 'open' });
      if (open === 0) {
        await Resource.updateOne({ _id: report.targetId }, { availability: 'available', flagged: false });
      }
    }
    res.json({ report });
  } catch (err) { next(err); }
});

// User management
router.get('/users', async (req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).limit(200).lean();
    res.json({ users: users.map((u) => ({ ...u, password: undefined, verifyToken: undefined })) });
  } catch (err) { next(err); }
});

router.patch('/users/:id/role', async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!['student', 'admin'].includes(role)) return res.status(400).json({ message: 'Invalid role' });
    if (String(req.params.id) === String(req.user._id)) {
      return res.status(400).json({ message: "You can't change your own role" });
    }
    const user = await User.findByIdAndUpdate(req.params.id, { role, verified: true }, { new: true });
    res.json({ user: { id: user._id, name: user.name, role: user.role, verified: user.verified } });
  } catch (err) { next(err); }
});

export default router;
