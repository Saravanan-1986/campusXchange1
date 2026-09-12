import express from 'express';
import Report from '../models/Report.js';
import Resource from '../models/Resource.js';
import StudyMaterial from '../models/StudyMaterial.js';
import { requireAuth } from '../middleware/auth.js';
import { fireEvent } from '../services/active/engine.js';
import { logDbEvent } from '../services/eventlog.service.js';

/** Reports — user-submitted abuse flags; feed the report-auto-flag ECA rule. */
const router = express.Router();

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { targetType, targetId, reason, details } = req.body;
    if (!['resource', 'material', 'user'].includes(targetType)) {
      return res.status(400).json({ message: 'Invalid target type' });
    }
    await Report.create({ reporter: req.user._id, targetType, targetId, reason, details });

    let reportsCount = 0;
    if (targetType === 'resource') {
      const r = await Resource.findByIdAndUpdate(targetId, { $inc: { reportsCount: 1 } }, { new: true });
      reportsCount = r?.reportsCount || 0;
    } else if (targetType === 'material') {
      const m = await StudyMaterial.findByIdAndUpdate(targetId, { $inc: { reportsCount: 1 } }, { new: true });
      reportsCount = m?.reportsCount || 0;
    }
    await logDbEvent('active', 'report.created', `Report on ${targetType} (count=${reportsCount})`, { targetId: String(targetId) });

    // Fire ECA event — the report-auto-flag rule decides whether to act
    await fireEvent('report.created', { targetType, targetId, reportsCount });

    res.status(201).json({ ok: true, reportsCount });
  } catch (err) { next(err); }
});

export default router;
