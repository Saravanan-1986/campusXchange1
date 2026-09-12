import express from 'express';
import Resource from '../models/Resource.js';
import { requireAuth } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { recordResourceState, getResourceTimeline } from '../services/history.service.js';
import { syncResourceToGraph, removeResourceFromGraph } from '../services/graph.service.js';
import { logDbEvent } from '../services/eventlog.service.js';

/**
 * Physical Resource Marketplace.
 * SPATIAL: `near` filter uses MongoDB $near on the 2dsphere index.
 * TEMPORAL: every mutation records a ResourceHistory snapshot.
 * GRAPH: every write syncs the resource subgraph to Neo4j.
 */
const router = express.Router();

const ALLOWED = ['title', 'description', 'category', 'subject', 'department', 'semester', 'condition', 'listingType', 'price', 'tags'];

function parseLocation(body) {
  const loc = body.location;
  if (!loc || !Array.isArray(loc.coordinates)) return null;
  const [lng, lat] = loc.coordinates;
  if (!Number.isFinite(Number(lng)) || !Number.isFinite(Number(lat))) return null;
  return { type: 'Point', coordinates: [Number(lng), Number(lat)], label: loc.label || '' };
}

// LIST + FILTER (+ optional geospatial `near` filter)
router.get('/', async (req, res, next) => {
  try {
    const { q, category, condition, listingType, minPrice, maxPrice, availability, department, semester, near, radius, sort } = req.query;
    const filter = {};
    if (q) filter.$text = { $search: q };
    if (category) filter.category = category;
    if (condition) filter.condition = condition;
    if (listingType) filter.listingType = listingType;
    if (availability) filter.availability = availability;
    if (department) filter.department = department;
    if (semester) filter.semester = Number(semester);
    if (minPrice || maxPrice) filter.price = { ...(minPrice ? { $gte: Number(minPrice) } : {}), ...(maxPrice ? { $lte: Number(maxPrice) } : {}) };
    // SPATIAL paradigm: /api/resources?near=lng,lat&radius=5 (km)
    if (near) {
      const [lng, lat] = near.split(',').map(Number);
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        filter.location = {
          $near: {
            $geometry: { type: 'Point', coordinates: [lng, lat] },
            $maxDistance: (Number(radius) || 10) * 1000,
          },
        };
        await logDbEvent('spatial', 'query.$near', `$near query within ${radius || 10}km of [${lng},${lat}]`, {});
      }
    }
    const sortMap = {
      price_asc: { price: 1 }, price_desc: { price: -1 },
      rating: { ratingAvg: -1 }, newest: { createdAt: -1 },
    };
    const resources = await Resource.find(filter)
      .populate('ownerId', 'name department semester')
      .sort(sortMap[sort] || { createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ resources });
  } catch (err) { next(err); }
});

// CREATE (auth) — with images + optional location pin
router.post('/', requireAuth, upload.array('images', 4), async (req, res, next) => {
  try {
    const data = {};
    ALLOWED.forEach((f) => { if (req.body[f] !== undefined) data[f] = req.body[f]; });
    data.ownerId = req.user._id;
    data.tags = typeof req.body.tags === 'string'
      ? req.body.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
      : req.body.tags || [];
    const loc = parseLocation(req.body);
    if (loc) {
      data.location = loc;
      await logDbEvent('spatial', 'geo.indexed', `Resource geo-tagged at ${loc.label || loc.coordinates}`, {});
    }
    if (req.files?.length) data.images = req.files.map((f) => f.filename);
    const resource = await Resource.create(data);
    await recordResourceState(resource, { actorLabel: req.user.name, source: 'user', summary: 'Listed on marketplace' });
    await syncResourceToGraph(resource, req.user.name);
    res.status(201).json({ resource });
  } catch (err) { next(err); }
});

// MY LISTINGS
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const resources = await Resource.find({ ownerId: req.user._id }).sort({ createdAt: -1 }).lean();
    res.json({ resources });
  } catch (err) { next(err); }
});

// DETAIL
router.get('/:id', async (req, res, next) => {
  try {
    const resource = await Resource.findById(req.params.id).populate('ownerId', 'name department semester gradYear bio');
    if (!resource) return res.status(404).json({ message: 'Resource not found' });
    res.json({ resource });
  } catch (err) { next(err); }
});


// UPDATE (owner or admin) — records a temporal version with changed fields
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const resource = await Resource.findById(req.params.id).populate('ownerId', 'name');
    if (!resource) return res.status(404).json({ message: 'Resource not found' });
    if (String(resource.ownerId._id) !== String(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not your listing' });
    }
    const changed = [];
    ALLOWED.forEach((f) => {
      if (req.body[f] !== undefined && String(resource[f]) !== String(req.body[f])) {
        resource[f] = req.body[f];
        changed.push(f);
      }
    });
    const loc = parseLocation(req.body);
    if (loc) { resource.location = loc; changed.push('location'); }
    if (Array.isArray(req.body.tags)) resource.tags = req.body.tags;
    await resource.save();
    if (changed.length) {
      await recordResourceState(resource, {
        actorLabel: req.user.name, source: 'user', fields: changed,
      });
      await syncResourceToGraph(resource, resource.ownerId.name);
    }
    res.json({ resource });
  } catch (err) { next(err); }
});

// DELETE (owner or admin)
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) return res.status(404).json({ message: 'Resource not found' });
    if (String(resource.ownerId) !== String(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not your listing' });
    }
    await resource.deleteOne();
    await removeResourceFromGraph(resource._id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// TEMPORAL PARADIGM — lifecycle timeline (owner names are stored anonymized)
router.get('/:id/history', async (req, res, next) => {
  try {
    const history = await getResourceTimeline(req.params.id);
    res.json({ history });
  } catch (err) { next(err); }
});

export default router;
