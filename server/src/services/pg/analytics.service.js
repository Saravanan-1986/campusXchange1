import { rows, row } from '../../config/pg.js';

/**
 * ANALYTICS service — the SQL side of the platform.
 * Aggregates, window functions, percentiles, generate_series trends and a
 * materialized view. Every number the admin "SQL Analytics" tab shows comes
 * from one of the cx_* functions created by migration 005.
 */
const n = (v) => (v === null || v === undefined ? null : Number(v));

function numRow(r) {
  if (!r) return r;
  const out = { ...r };
  for (const k of ['price', 'min_price', 'max_price', 'avg_price', 'median_price', 'p90',
    'stddev_price', 'from_price', 'to_price', 'listings', 'active_listings', 'available',
    'out_on_lend', 'sell_listings', 'inventory_value', 'avg_rating', 'distinct_owners',
    'new_versions', 'price_changes', 'cumulative_listings', 'versions', 'price_drops',
    'events', 'volatility', 'lends', 'returned', 'overdue', 'avg_held_days', 'rank',
    'running_total', 'students', 'resources', 'total_value']) {
    if (k in out) out[k] = n(out[k]);
  }
  return out;
}

export async function overview() {
  const r = await row(`SELECT cx_analytics_overview() AS kpis`, [], 'analytics-overview');
  const kpis = r?.kpis || {};
  for (const k of ['inventoryValue', 'avgPrice', 'avgVersionsPerItem', 'avgHeldDays',
    'listings', 'availableListings', 'versionsRecorded', 'resourcesVersioned',
    'lendsOut', 'lendsOverdue', 'lendsClosed', 'eventsFired', 'eventsPending',
    'rulesArmed', 'campusZones', 'geoTaggedResources', 'geoTaggedStudents',
    'indexedDocuments', 'watchList']) {
    if (k in kpis) kpis[k] = n(kpis[k]);
  }
  const [trend, priceStats, bands, lenders, changed, categories] = await Promise.all([
    rows(`SELECT * FROM cx_listing_trend(21)`, [], 'trend'),
    rows(`SELECT * FROM cx_price_stats()`, [], 'price-stats'),
    rows(`SELECT * FROM cx_price_bands(6)`, [], 'price-bands'),
    rows(`SELECT * FROM cx_top_lenders(8)`, [], 'top-lenders'),
    rows(`SELECT * FROM cx_most_changed_resources(8)`, [], 'most-changed'),
    rows(`SELECT * FROM mv_campus_activity ORDER BY listings DESC LIMIT 20`, [], 'mv-categories'),
  ]);
  return {
    kpis,
    trend: trend.map(numRow),
    priceStats: priceStats.map(numRow),
    priceBands: bands.map(numRow),
    topLenders: lenders.map(numRow),
    mostChanged: changed.map(numRow),
    categories: categories.map(numRow),
  };
}

export async function trend(days = 21) {
  return (await rows(`SELECT * FROM cx_listing_trend($1)`, [Number(days) || 21], 'trend')).map(numRow);
}

export async function topLenders(limit = 10) {
  return (await rows(`SELECT * FROM cx_top_lenders($1)`, [Number(limit) || 10], 'top-lenders')).map(numRow);
}

export async function priceStats() {
  return (await rows(`SELECT * FROM cx_price_stats()`, [], 'price-stats')).map(numRow);
}

export async function priceBands(buckets = 6) {
  return (await rows(`SELECT * FROM cx_price_bands($1)`, [Number(buckets) || 6], 'price-bands')).map(numRow);
}

export async function mostChanged(limit = 10) {
  return (await rows(`SELECT * FROM cx_most_changed_resources($1)`, [Number(limit) || 10], 'most-changed')).map(numRow);
}

/** Department × category performance, straight out of the materialized view. */
export async function categories() {
  return (await rows(`SELECT * FROM mv_campus_activity ORDER BY listings DESC`, [], 'mv-categories')).map(numRow);
}

export async function refresh() {
  return row(`SELECT cx_refresh_analytics() AS refreshed_at`, [], 'mv-refresh');
}
