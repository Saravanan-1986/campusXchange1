import express from 'express';
import {
  getRelatedResources, getStudentsAlsoUsed, getGraphOverview, getGraphData,
} from '../services/graph.queries.js';
import { logDbEvent } from '../services/eventlog.service.js';

/**
 * GRAPH PARADIGM endpoints — Neo4j-powered discovery, Mongo fallback tagged.
 */
const router = express.Router();

// Related resources (shared Subject traversal)
router.get('/resources/:id/related', async (req, res, next) => {
  try {
    const result = await getRelatedResources(req.params.id, 10);
    await logDbEvent('graph', 'query.related', `related-resources for ${req.params.id} (${result.source})`, {});
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

export default router;
