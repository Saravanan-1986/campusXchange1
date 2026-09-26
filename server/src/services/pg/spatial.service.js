import { rows, row, pgInfo } from '../../config/pg.js';

/**
 * SPATIAL PARADIGM service.
 * The provider is chosen by the database itself (see migration 001/004):
 *   postgis      → geography + ST_DWithin + GiST (KNN ordering)
 *   earthdistance → cube(earth) + earth_box @> prefilter + GiST
 *   bbox         → bounding-box prefilter + haversine (no extension at all)
 * The application code below is identical in all three cases.
 */
const n = (v) => (v === null || v === undefined ? null : Number(v));

function numRow(r) {
  if (!r) return r;
  const out = { ...r };
  for (const k of ['distance_m', 'price', 'resources', 'students', 'lat', 'lon',
    'cell_lat', 'cell_lon', 'available', 'avg_price', 'total_value']) {
    if (k in out) out[k] = n(out[k]);
  }
  if (out.distance_m != null) out.distance_km = Math.round((out.distance_m / 1000) * 100) / 100;
  return out;
}

export function providerInfo() {
  return pgInfo();
}

/** Index-accelerated radius search over marketplace listings. */
export async function nearbyResources(lat, lon, radiusKm = 5, { onlyAvailable = true, limit = 120 } = {}) {
  const data = await rows(
    `SELECT * FROM cx_nearby_resources($1, $2, $3, $4) LIMIT $5`,
    [Number(lat), Number(lon), Number(radiusKm) * 1000, !!onlyAvailable, Number(limit)],
    'nearby-resources'
  );
  return data.map(numRow);
}

/** Radius search over students (Neo4j-free, pure SQL). */
export async function nearbyStudents(lat, lon, radiusKm = 5, { limit = 60 } = {}) {
  const data = await rows(
    `SELECT * FROM cx_nearby_students($1, $2, $3) LIMIT $4`,
    [Number(lat), Number(lon), Number(radiusKm) * 1000, Number(limit)],
    'nearby-students'
  );
  return data.map(numRow);
}

/** Campus zones ranked by great-circle distance. */
export async function nearbyZones(lat, lon, limit = 12) {
  const data = await rows(`SELECT * FROM cx_nearby_zones($1, $2, $3)`,
    [Number(lat), Number(lon), Number(limit)], 'nearby-zones');
  return data.map(numRow);
}

/** Everything the Near Me map needs, in one round trip. */
export async function mapSnapshot(lat, lon, radiusKm = 5, { onlyAvailable = true } = {}) {
  const [resources, students, zones, grid] = await Promise.all([
    nearbyResources(lat, lon, radiusKm, { onlyAvailable }),
    nearbyStudents(lat, lon, radiusKm),
    nearbyZones(lat, lon, 8),
    densityGrid(),
  ]);
  return {
    center: { lat: Number(lat), lon: Number(lon) },
    radiusKm: Number(radiusKm),
    provider: pgInfo().spatialProvider,
    resources,
    students,
    zones,
    grid,
  };
}

/** SQL-side clustering: bucket points into a lat/lon grid (no app math). */
export async function densityGrid(cellDeg = 0.002) {
  const data = await rows(`SELECT * FROM cx_density_grid($1)`, [Number(cellDeg)], 'density-grid');
  return data.map(numRow);
}

/** Where is a given listing, and in which campus zone? */
export async function resourceSpot(resourceId) {
  return numRow(await row(
    `SELECT g.resource_id, g.lat, g.lon, g.label AS place_label, g.zone_id, g.updated_at,
            z.name AS zone_name, z.kind AS zone_kind, z.lat AS zone_lat, z.lon AS zone_lon,
            cx_distance_m(z.lat, z.lon, g.lat, g.lon)::numeric(10,1) AS distance_to_zone_m
       FROM geo_resource g
       LEFT JOIN campus_zone z ON z.zone_id = g.zone_id
      WHERE g.resource_id = $1`, [String(resourceId)], 'resource-spot'
  ));
}

/** Per-zone rollup (GROUP BY across the spatial + document layers). */
export async function zoneSummary() {
  const data = await rows(`SELECT * FROM cx_zone_summary()`, [], 'zone-summary');
  return data.map(numRow);
}

/** Insert/update campus zones (admin tool + seeder). */
export async function upsertZone({ zoneId, name, kind = 'block', lat, lon, capacity = null }) {
  const r = await row(
    `INSERT INTO campus_zone (zone_id, name, kind, lat, lon, capacity)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (zone_id) DO UPDATE
       SET name = EXCLUDED.name, kind = EXCLUDED.kind, lat = EXCLUDED.lat,
           lon = EXCLUDED.lon, capacity = EXCLUDED.capacity, updated_at = now()
     RETURNING *`,
    [String(zoneId), name, kind, Number(lat), Number(lon), capacity === null ? null : Number(capacity)],
    'upsert-zone'
  );
  return numRow(r);
}

/** Distance between two named campus zones (pure SQL). */
export async function distanceBetweenZones(a, b) {
  return numRow(await row(
    `SELECT a.name AS from_zone, b.name AS to_zone,
            round((cx_distance_m(a.lat, a.lon, b.lat, b.lon) / 1000)::numeric, 3) AS distance_km,
            round((cx_distance_m(a.lat, a.lon, b.lat, b.lon) / 1.4)::numeric, 1)  AS walk_minutes
       FROM campus_zone a, campus_zone b
      WHERE a.zone_id = $1 AND b.zone_id = $2`, [a, b], 'zone-distance'
  ));
}
