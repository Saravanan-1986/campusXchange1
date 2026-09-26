import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as searchService from '../services/pg/search.service.js';
import { pgStatus } from '../config/pg.js';
import { logDbEvent } from '../services/eventlog.service.js';
import Resource from '../models/Resource.js';
import StudyMaterial from '../models/StudyMaterial.js';
import User from '../models/User.js';
import { getRelatedResources } from '../services/graph.queries.js';

/**
 * HYBRID SEARCH — the polyglot query.
 *
 *  1. PostgreSQL   : indexed full-text search (tsvector + GIN) ranks and
 *                    highlights the candidates (ts_rank_cd + ts_headline).
 *  2. MongoDB      : supplies the rich documents for the winning ids.
 *  3. PostgreSQL   : trgm similarity covers typos ("calculater" → "calculator").
 *  4. Neo4j        : optional graph expansion of the top hit's subject.
 *
 * One request, three engines, each doing what it is best at.
 */
const router = express.Router();

async function hydrate(results) {
  const resourceIds = results.filter((r) => r.kind === 'resource').map((r) => r.doc_id);
  const materialIds = results.filter((r) => r.kind === 'material').map((r) => r.doc_id);
  const [resources, materials] = await Promise.all([
    resourceIds.length
      ? Resource.find({ _id: { $in: resourceIds } }).populate('ownerId', 'name department').lean()
      : [],
    materialIds.length
      ? StudyMaterial.find({ _id: { $in: materialIds } }).populate('uploadedBy', 'name department').lean()
      : [],
  ]);
  const byId = new Map([
    ...resources.map((r) => [String(r._id), { type: 'resource', doc: r }]),
    ...materials.map((m) => [String(m._id), { type: 'material', doc: m }]),
  ]);
  return results.map((hit) => {
    const found = byId.get(hit.doc_id);
    return {
      ...hit,
      matchedBy: hit.snippet,
      document: found?.doc || null,
      type: found?.type || hit.kind,
    };
  });
}

router.get('/', async (req, res, next) => {
  try {
    const { q, kind, department, semester, availability } = req.query;
    if (pgStatus() !== 'connected') {
      // Graceful degradation: MongoDB $text search still answers.
      const mongo = q
        ? await Resource.find({ $text: { $search: q } }, { score: { $meta: 'textScore' } })
            .sort({ score: { $meta: 'textScore' } }).limit(20)
            .populate('ownerId', 'name').lean()
        : [];
      return res.json({ method: 'mongo-text-fallback', count: mongo.length, results: mongo.map((d) => ({ doc_id: String(d._id), kind: 'resource', title: d.title, document: d, type: 'resource' })) });
    }
    const raw = await searchService.search({ q, kind, department, semester, availability, limit: req.query.limit });
    const results = await hydrate(raw.results);
    await logDbEvent('spatial', 'search.hybrid',
      `Hybrid search "${raw.q}" (${raw.method}) → ${results.length} hit(s)`, { method: raw.method });
    res.json({ source: 'postgresql+neo4j+mongodb', ...raw, results });
  } catch (err) { next(err); }
});

router.get('/suggest', async (req, res, next) => {
  try {
    if (pgStatus() !== 'connected') return res.json({ suggestions: [] });
    res.json({ suggestions: await searchService.suggest(req.query.q, req.query.limit) });
  } catch (err) { next(err); }
});

/**
 * People + subject discovery that spans all three engines:
 * PG full-text finds the best matching listing, Neo4j expands its subject
 * neighbourhood, MongoDB resolves the final documents.
 */
router.get('/discover', async (req, res, next) => {
  try {
    const term = String(req.query.q || '').trim();
    if (!term) return res.status(400).json({ message: 'q is required' });
    let leader = null;
    let graph = null;

    if (pgStatus() === 'connected') {
      const raw = await searchService.search({ q: term, kind: 'resource', limit: 1 });
      leader = raw.results[0] || null;
    }
    if (!leader) {
      const doc = await Resource.findOne({ $text: { $search: term } }).lean();
      if (doc) leader = { doc_id: String(doc._id), title: doc.title, kind: 'resource' };
    }
    if (leader) graph = await getRelatedResources(leader.doc_id, 8);

    // MongoDB supplies the rich document (and the person behind it)
    const leaderDoc = leader
      ? await Resource.findById(leader.doc_id).populate('ownerId', 'name department semester').lean().catch(() => null)
      : null;

    res.json({
      query: term,
      leader: leader ? { ...leader, document: leaderDoc, owner: leaderDoc?.ownerId || null } : null,
      related: graph,
      engines: {
        postgresql: leader ? 'matched by tsvector rank' : 'no FTS hit',
        neo4j: graph?.source || 'skipped',
        mongodb: leaderDoc ? 'document + owner resolved' : 'skipped',
      },
    });
  } catch (err) { next(err); }
});

export default router;
