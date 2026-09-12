import Resource from '../models/Resource.js';
import { logDbEvent } from './eventlog.service.js';

/**
 * GRAPH PARADIGM (Neo4j) — recommendation queries.
 * Every query first attempts a real Cypher graph traversal; if Neo4j is
 * unreachable, a Mongo approximation runs instead and the response is tagged
 * `source: 'mongo-fallback'` so the demo panel can show which engine answered.
 */
export async function getRelatedResources(resourceId, limit = 10) {
  return runQuery(
    `MATCH (r:Resource {id:$rid})-[:IN_SUBJECT]->(sub)<-[:IN_SUBJECT]-(other)
     WHERE other.id <> $rid
     RETURN other.id AS id, other.title AS title, other.category AS category,
            count(DISTINCT sub) AS sharedSubjects, other.semester AS semester
     ORDER BY sharedSubjects DESC LIMIT $limit`,
    { rid: String(resourceId), limit },
    async () => {
      const r = await Resource.findById(resourceId).lean();
      if (!r) return [];
      const key = r.subject || r.category;
      const alt = await Resource.find({
        _id: { $ne: r._id },
        $or: [{ subject: key }, { category: r.category }],
      }).limit(limit).lean();
      return alt.map((x) => ({
        id: String(x._id), title: x.title, category: x.category,
        sharedSubjects: x.subject === key ? 1 : 0, semester: x.semester || null,
      }));
    }
  );
}

/** "Students who used this also used" — collaborative filter via USED/REVIEWED edges. */
export async function getStudentsAlsoUsed(resourceId, excludeUserId, limit = 10) {
  return runQuery(
    `MATCH (:Resource {id:$rid})<-[:USED|REVIEWED]-(p1:Student)<-[:USED|REVIEWED]-(peer:Student)-[:USED|REVIEWED]->(rec:Resource)
     WHERE rec.id <> $rid ${'AND'} (peer.id <> $uid OR $uid IS NULL)
     RETURN rec.id AS id, rec.title AS title, count(*) AS weight
     ORDER BY weight DESC LIMIT $limit`,
    { rid: String(resourceId), uid: excludeUserId ? String(excludeUserId) : null, limit },
    async () => {
      const r = await Resource.findById(resourceId).lean();
      if (!r) return [];
      const alt = await Resource.find({
        _id: { $ne: r._id }, category: r.category,
      }).sort({ ratingAvg: -1, ratingCount: -1 }).limit(limit).lean();
      return alt.map((x) => ({ id: String(x._id), title: x.title, weight: x.ratingCount }));
    }
  );
}


/** Department ↔ Subject ↔ Resource relationship traversal for the graph explorer. */
export async function getGraphOverview(limit = 40) {
  return runQuery(
    `MATCH (d:Department)<-[:BELONGS_TO]-(s:Subject)<-[:IN_SUBJECT]-(r:Resource)
     OPTIONAL MATCH (st:Student)-[:OWNS]->(r)
     RETURN d.name AS department, s.name AS subject,
            count(DISTINCT r) AS resources, collect(DISTINCT st.name)[..3] AS owners
     ORDER BY resources DESC LIMIT $limit`,
    { limit },
    async () => {
      const agg = await Resource.aggregate([
        { $group: { _id: { d: '$department', s: { $ifNull: ['$subject', '$category'] } }, n: { $sum: 1 } } },
        { $sort: { n: -1 } }, { $limit: limit },
      ]);
      return agg.map((a) => ({
        department: a._id.d || 'General', subject: a._id.s,
        resources: a.n, owners: [],
      }));
    }
  );
}

/** Full subgraph for the interactive force-directed visualization. */
export async function getGraphData(resourceId, depth = 2) {
  return runQuery(
    `MATCH p=(c:Resource {id:$rid})-[r*1..${depth}]-(n)
     UNWIND relationships(p) AS rel
     WITH DISTINCT rel, startNode(rel) AS a, endNode(rel) AS b
     RETURN a.id AS aId, labels(a)[0] AS aLabel, coalesce(a.title, a.name) AS aName,
            b.id AS bId, labels(b)[0] AS bLabel, coalesce(b.title, b.name) AS bName, type(rel) AS relType`,
    { rid: String(resourceId) },
    async () => {
      const c = await Resource.findById(resourceId).lean();
      if (!c) return { nodes: [], links: [] };
      const related = await Resource.find({
        $or: [{ subject: c.subject || c.category }, { category: c.category }],
        _id: { $ne: c._id },
      }).limit(6).lean();
      return buildFallbackGraph(c, related);
    },
    true
  );
}

function buildFallbackGraph(center, related) {
  const nodes = [{ id: 'r_' + center._id, label: 'Resource', name: center.title }];
  const links = [];
  nodes.push({ id: 's_' + (center.subject || center.category), label: 'Subject', name: center.subject || center.category });
  links.push({ source: nodes[0].id, target: nodes[1].id, relType: 'IN_SUBJECT' });
  nodes.push({ id: 'd_' + (center.department || 'General'), label: 'Department', name: center.department || 'General' });
  links.push({ source: nodes[1].id, target: nodes[2].id, relType: 'BELONGS_TO' });
  related.forEach((r) => {
    nodes.push({ id: 'r_' + r._id, label: 'Resource', name: r.title });
    links.push({ source: 'r_' + r._id, target: nodes[1].id, relType: 'IN_SUBJECT' });
  });
  return { nodes, links };
}

/**
 * Shared runner: try Neo4j, fall back to Mongo.
 */
async function runQuery(cypher, params, fallbackFn, raw = false) {
  try {
    const { run } = await import('./graph.service.js');
    const records = await run(cypher, params);
    if (records && records.length) {
      const rows = records.map((rec) => {
        const o = {};
        rec.keys.forEach((k) => { o[k] = rec.get(k); });
        return o;
      });
      return { source: 'neo4j', data: raw ? shapeGraphData(rows) : rows };
    }
  } catch (err) {
    console.warn('[graph] traversal failed:', err.message);
  }
  await logDbEvent('graph', 'fallback.mongo', 'Neo4j unavailable — Mongo fallback query served', {});
  const data = await fallbackFn();
  return { source: 'mongo-fallback', data };
}

function shapeGraphData(rows) {
  const nodes = new Map();
  const links = [];
  rows.forEach((row) => {
    if (row.aId && !nodes.has(row.aId)) nodes.set(row.aId, { id: row.aId, label: row.aLabel, name: row.aName });
    if (row.bId && !nodes.has(row.bId)) nodes.set(row.bId, { id: row.bId, label: row.bLabel, name: row.bName });
    if (row.aId && row.bId) links.push({ source: row.aId, target: row.bId, relType: row.relType });
  });
  return { nodes: [...nodes.values()], links };
}
