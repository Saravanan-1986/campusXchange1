import express from 'express';
import {
  getRelatedResources, getStudentsAlsoUsed, getGraphOverview, getGraphData,
  getHandoverChain, getSameHandsResources,
} from '../services/graph.queries.js';
import { graphCounts, verifyNeo4j, neo4jStatus, getDriver } from '../services/graph.service.js';
import { seedGraphFromMongo } from '../services/graph.seed.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logDbEvent } from '../services/eventlog.service.js';

/**
 * GRAPH PARADIGM endpoints — Neo4j-powered discovery, Mongo fallback tagged.
 *
 *   GET  /api/graph/resources/:id/related     related items (3-signal traversal)
 *   GET  /api/graph/resources/:id/chain       handovers of this item (GAVE edges)
 *   GET  /api/graph/resources/:id/also-used   collaborative filtering
 *   GET  /api/graph/data/:resourceId          subgraph for the force-graph view
 *   GET  /api/graph/overview                  Department → Subject → Resource
 *   GET  /api/graph/users/:id/same-hands      "also had" via RECEIVED/OWNS edges
 *   GET  /api/graph/status                    connectivity + node/edge census
 *   POST /api/graph/sync                      rebuild the graph from MongoDB
 */
const router = express.Router();

// Related resources (shared Subject + same hands + same custodian)
router.get('/resources/:id/related', async (req, res, next) => {
  try {
    const result = await getRelatedResources(req.params.id, Number(req.query.limit) || 10);
    await logDbEvent('graph', 'query.related', `related-resources for ${req.params.id} (${result.source})`, {});
    res.json(result);
  } catch (err) { next(err); }
});

// Custody chain of one item, read from the graph (Student-[:GAVE]->Student)
router.get('/resources/:id/chain', async (req, res, next) => {
  try {
    const result = await getHandoverChain(req.params.id);
    await logDbEvent('graph', 'query.chain', `handover chain for ${req.params.id} (${result.source})`, {});
    res.json(result);
  } catch (err) { next(err); }
});

// "Students who used this also used"
router.get('/resources/:id/also-used', async (req, res, next) => {
  try {
    const result = await getStudentsAlsoUsed(req.params.id, null, 10);
    await logDbEvent('graph', 'query.collab', `collaborative filter for ${req.params.id} (${result.source})`, {});
    res.json(result);
  } catch (err) { next(err); }
});

// Items that travelled through the same hands as this student's items
router.get('/users/:id/same-hands', async (req, res, next) => {
  try {
    const result = await getSameHandsResources(req.params.id, req.query.excludeResourceId || null, 10);
    res.json(result);
  } catch (err) { next(err); }
});

// Department ↔ Subject ↔ Resource overview
router.get('/overview', async (req, res, next) => {
  try {
    const result = await getGraphOverview(40);
    res.json(result);
  } catch (err) { next(err); }
});

// Full subgraph for the force-directed visualization
router.get('/data/:resourceId', async (req, res, next) => {
  try {
    const depth = Number(req.query.depth) || 2;
    const result = await getGraphData(req.params.resourceId, depth);
    res.json(result);
  } catch (err) { next(err); }
});

// Connectivity check + node/relationship census (powers the DB monitor)
router.get('/status', async (req, res) => {
  await verifyNeo4j();
  const connected = neo4jStatus() === 'connected';
  try {
    const counts = connected ? await graphCounts() : { nodes: 0, relationships: 0, byLabel: [], byType: [] };
    res.json({
      status: neo4jStatus(),
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      database: process.env.NEO4J_DATABASE || 'neo4j',
      ...counts,
    });
  } catch (err) {
    res.json({ status: 'unavailable', uri: process.env.NEO4J_URI || 'bolt://localhost:7687', message: err.message });
  }
});

/**
 * POST /api/graph/sync — rebuild the whole graph from MongoDB (wipe + MERGE).
 * Admin-only in normal use; the CLI script `npm run graph:sync` does the same.
 */
router.post('/sync', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const wipe = req.body?.wipe !== false;
    const result = await seedGraphFromMongo({ wipe });
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

// Close the driver on demand (useful when Neo4j Desktop was restarted).
router.post('/reconnect', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    try { await getDriver().close(); } catch { /* already closed */ }
    const online = await verifyNeo4j();
    res.json({ ok: online, status: neo4jStatus() });
  } catch (err) { next(err); }
});

export default router;
