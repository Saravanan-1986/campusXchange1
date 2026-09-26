import express from 'express';
import Resource from '../models/Resource.js';
import User from '../models/User.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as spatial from '../services/pg/spatial.service.js';
import { pgStatus } from '../config/pg.js';
import { logDbEvent } from '../services/eventlog.service.js';

/**
 * SPATIAL PARADIGM endpoints — PostgreSQL does the geometry.
 *
 *   PostGIS installed → geography(Point,4326) + ST_DWithin on a GiST index
 *   otherwise         → cube + earthdistance (earth_box @> earth + earth_distance)
 *   neither           → bounding-box prefilter + haversine
 * The provider is detected by the database itself and echoed on every response.
 *
 * Polyglot twist: PostgreSQL decides *which* listings are near (indexed radius
 * search), then MongoDB supplies the rich documents + images for those ids.
 */
const router = express.Router();

function guard(res) {
  if (pgStatus() !== 'connected') {
    res.status(503).json({ message: 'PostgreSQL spatial layer unavailable — run `npm run db:migrate`' });
    return false;
  }
  return true;
}

function at(q) {
  const [lon, lat] = String(q || '').split(',').map(Number);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

/** Enrich PG rows with the MongoDB documents (images, owner, rating). */
async function hydrate(rows) {
  const ids = rows.map((r) => r.resource_id);
  if (!ids.length) return [];
  const docs = await Resource.find({ _id: { $in: ids } })
    .populate('ownerId', 'name department semester').lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return rows.map((r) => {
    const doc = byId.get(r.resource_id);
    return {
      // shape kept compatible with the Leaflet page
      _id: r.resource_id,
      title: r.title,
      category: r.category,
      subject: r.subject,
      department: r.department,
      semester: r.semester,
      condition: r.condition,
      price: Number(r.price),
      availability: r.availability,
      listingType: r.listing_type,
      images: doc?.images || [],
      ratingAvg: doc?.ratingAvg ?? 0,
      ratingCount: doc?.ratingCount ?? 0,
      ownerId: doc?.ownerId || { _id: r.owner_id, name: r.owner_label },
      location: { type: 'Point', coordinates: [Number(r.lon), Number(r.lat)], label: r.place_label },
      zone: { id: r.zone_id, name: r.zone_name },
      distanceKm: Math.round((Number(r.distance_m) / 1000) * 100) / 100,
      distanceM: Number(r.distance_m),
    };
  });
}

/** MongoDB fallback when PostgreSQL is down (2dsphere still works). */
async function mongoNearby(lon, lat, radiusKm, onlyAvailable) {
  const filter = { location: { $geoWithin: { $centerSphere: [[lon, lat], radiusKm / 6378.1] } } };
  if (onlyAvailable) filter.availability = 'available';
  const resources = await Resource.find(filter).populate('ownerId', 'name department').limit(60).lean();
  return {
    source: 'mongo-fallback',
    provider: 'mongodb-2dsphere',
    resources: resources.map((r) => ({ ...r, distanceKm: null, zone: null })),
  };
}

// GET /api/spatial/status
router.get('/status', (req, res) => {
  const info = spatial.providerInfo();
  res.json({ postgres: info, available: pgStatus() === 'connected', provider: info.spatialProvider });
});

// GET /api/spatial/map?at=lng,lat&radius=5&availableOnly=true
router.get('/map', async (req, res, next) => {
  try {
    const p = at(req.query.at);
    if (!p) return res.status(400).json({ message: 'at=lng,lat is required' });
    const radiusKm = Number(req.query.radius) || 5;
    if (!guard(res)) {
      const fallback = await mongoNearby(p.lon, p.lat, radiusKm, req.query.availableOnly !== 'false');
      return res.json({ ...fallback, center: p, radiusKm });
    }
    const snapshot = await spatial.mapSnapshot(p.lat, p.lon, radiusKm, {
      onlyAvailable: req.query.availableOnly !== 'false',
    });
    const resources = await hydrate(snapshot.resources);
    await logDbEvent('spatial', `query.${snapshot.provider}`,
      `${snapshot.provider} radius ${radiusKm}km @ [${p.lat},${p.lon}] → ${resources.length} listing(s), ${snapshot.students.length} student(s)`,
      { provider: snapshot.provider });
    res.json({ source: 'postgresql', ...snapshot, resources });
  } catch (err) { next(err); }
});


// GET /api/spatial/resources/near?at=lng,lat&radius=5&availability=available
router.get('/resources/near', async (req, res, next) => {
  try {
    const p = at(req.query.at);
    if (!p) return res.status(400).json({ message: 'at=lng,lat is required' });
    const radiusKm = Number(req.query.radius) || 5;
    if (!guard(res)) {
      const fallback = await mongoNearby(p.lon, p.lat, radiusKm, (req.query.availability || 'available') === 'available');
      return res.json({ ...fallback, center: [p.lon, p.lat], radiusKm });
    }
    const rows = await spatial.nearbyResources(p.lat, p.lon, radiusKm, {
      onlyAvailable: (req.query.availability || 'available') === 'available',
    });
    const resources = await hydrate(rows);
    res.json({
      source: 'postgresql',
      provider: spatial.providerInfo().spatialProvider,
      center: [p.lon, p.lat],
      radiusKm,
      radiusM: radiusKm * 1000,
      count: resources.length,
      resources,
      // raw SQL rows, for the "show me the actual database response" panel
      sqlRows: rows,
    });
  } catch (err) { next(err); }
});

// GET /api/spatial/students/near?at=lng,lat&radius=5
router.get('/students/near', async (req, res, next) => {
  try {
    const p = at(req.query.at);
    if (!p) return res.status(400).json({ message: 'at=lng,lat is required' });
    const radiusKm = Number(req.query.radius) || 5;
    if (!guard(res)) {
      const students = await User.find({
        location: { $near: { $geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, $maxDistance: radiusKm * 1000 } },
      }).limit(40).lean();
      return res.json({
        source: 'mongo-fallback',
        students: students.map((s) => ({
          user_id: String(s._id), name: s.name, department: s.department, role: s.role,
          lat: s.location?.coordinates?.[1], lon: s.location?.coordinates?.[0],
          label: s.location?.label || '', zone_name: null, distance_m: null,
        })),
      });
    }
    const students = await spatial.nearbyStudents(p.lat, p.lon, radiusKm);
    await logDbEvent('spatial', 'query.nearby_students', `${students.length} student(s) within ${radiusKm}km`, {});
    res.json({ source: 'postgresql', provider: spatial.providerInfo().spatialProvider, count: students.length, students });
  } catch (err) { next(err); }
});

// GET /api/spatial/zones?at=lng,lat  (ranked by distance when `at` is given)
router.get('/zones', async (req, res, next) => {
  try {
    if (!guard(res)) return res.status(503).json({ message: 'PostgreSQL spatial layer unavailable' });
    const p = at(req.query.at);
    const zones = p
      ? await spatial.nearbyZones(p.lat, p.lon, req.query.limit)
      : await spatial.zoneSummary();
    res.json({ source: 'postgresql', provider: spatial.providerInfo().spatialProvider, zones });
  } catch (err) { next(err); }
});

// GET /api/spatial/zones/summary — per-zone rollup (SQL GROUP BY)
router.get('/zones/summary', async (req, res, next) => {
  try {
    if (!guard(res)) return res.status(503).json({ message: 'PostgreSQL spatial layer unavailable' });
    res.json({ source: 'postgresql', sql: 'cx_zone_summary()', zones: await spatial.zoneSummary() });
  } catch (err) { next(err); }
});

// GET /api/spatial/grid?cell=0.002 — SQL-side clustering for the map
router.get('/grid', async (req, res, next) => {
  try {
    if (!guard(res)) return res.status(503).json({ message: 'PostgreSQL spatial layer unavailable' });
    res.json({ source: 'postgresql', sql: 'cx_density_grid(cell_deg)', grid: await spatial.densityGrid(req.query.cell) });
  } catch (err) { next(err); }
});

// GET /api/spatial/resources/:id/spot — which campus zone is this listing in?
router.get('/resources/:id/spot', async (req, res, next) => {
  try {
    if (!guard(res)) return res.status(503).json({ message: 'PostgreSQL spatial layer unavailable' });
    const spot = await spatial.resourceSpot(req.params.id);
    if (!spot) return res.status(404).json({ message: 'No geo-tagged location for this resource' });
    res.json({ source: 'postgresql', sql: 'geo_resource ⋈ campus_zone (nearest-zone trigger)', spot });
  } catch (err) { next(err); }
});

// GET /api/spatial/distance?from=lib-main&to=main-canteen
router.get('/distance', async (req, res, next) => {
  try {
    if (!guard(res)) return res.status(503).json({ message: 'PostgreSQL spatial layer unavailable' });
    const d = await spatial.distanceBetweenZones(req.query.from, req.query.to);
    if (!d) return res.status(404).json({ message: 'Unknown zone id(s)' });
    res.json({ source: 'postgresql', ...d });
  } catch (err) { next(err); }
});

// POST /api/spatial/zones (admin) — add a campus zone
router.post('/zones', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    if (!guard(res)) return;
    const { zoneId, name, kind, lat, lon, capacity } = req.body;
    if (!zoneId || !name) return res.status(400).json({ message: 'zoneId and name are required' });
    const zone = await spatial.upsertZone({ zoneId, name, kind, lat, lon, capacity });
    await logDbEvent('spatial', 'zone.created', `Campus zone "${name}" stored at [${lat}, ${lon}]`, { zoneId });
    res.status(201).json({ zone });
  } catch (err) { next(err); }
});

export default router;
