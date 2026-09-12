import express from 'express';
import Resource from '../models/Resource.js';
import User from '../models/User.js';
import { logDbEvent } from '../services/eventlog.service.js';

/**
 * SPATIAL PARADIGM endpoints.
 * $geoWithin for radius search on resources + $near for people; both run on
 * MongoDB 2dsphere indexes and log to the DB monitor.
 */
const router = express.Router();

function coords(q) {
  const [lng, lat] = (q || '').split(',').map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

// GET /api/spatial/resources/near?at=lng,lat&radius=5&availability=available
router.get('/resources/near', async (req, res, next) => {
  try {
    const at = coords(req.query.at);
    if (!at) return res.status(400).json({ message: 'at=lng,lat is required' });
    const radiusKm = Number(req.query.radius) || 5;
    const filter = {
      location: {
        $geoWithin: { $centerSphere: [at, radiusKm / 6378.1] }, // radians of Earth
      },
    };
    if (req.query.availability) filter.availability = req.query.availability;
    const resources = await Resource.find(filter).populate('ownerId', 'name').limit(60).lean();
    await logDbEvent('spatial', 'query.$geoWithin',
      `$geoWithin $centerSphere radius ${radiusKm}km @ [${at}] → ${resources.length} hits`, {});
    res.json({ resources, center: at, radiusKm });
  } catch (err) { next(err); }
});

// GET /api/spatial/students/near?at=lng,lat&radius=5
router.get('/students/near', async (req, res, next) => {
  try {
    const at = coords(req.query.at);
    if (!at) return res.status(400).json({ message: 'at=lng,lat is required' });
    const radiusKm = Number(req.query.radius) || 5;
    const students = await User.find({
      location: { $near: { $geometry: { type: 'Point', coordinates: at }, $maxDistance: radiusKm * 1000 } },
    }).limit(40).lean();
    await logDbEvent('spatial', 'query.$near', `$near students within ${radiusKm}km → ${students.length}`, {});
    res.json({
      students: students.map((s) => ({
        id: s._id, name: s.name, department: s.department, semester: s.semester,
        location: s.location,
      })),
    });
  } catch (err) { next(err); }
});

export default router;
