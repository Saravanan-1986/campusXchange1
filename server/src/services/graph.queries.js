import Resource from '../models/Resource.js';
import { logDbEvent } from './eventlog.service.js';

/**
 * GRAPH PARADIGM (Neo4j) — recommendation queries.
 * Every query first attempts a real Cypher graph traversal; if Neo4j is
 * unreachable, a Mongo approximation runs instead and the response is tagged
 * `source: 'mongo-fallback'` so the demo panel can show which engine answered.
 */
/**
 * "Related items" — the flagship GRAPH feature.
 *
 * Three real graph signals are combined in ONE Cypher traversal:
 *   1. same Subject           (or an explicit RELATED_TO edge)  → weight 3
 *   2. same current custodian (:Student)-[:OWNS]-> both items   → weight 2
 *   3. same HANDS — items received by a student who also received
 *      this one ((:Student)-[:RECEIVED]-> both)                  → weight 4
 *
 * Signal 3 only exists because handovers are mirrored as GAVE/RECEIVED edges,
 * so "people who had this product also had …" is a two-hop pattern no document
 * query expresses naturally.
 */
export async function getRelatedResources(resourceId, limit = 10) {
  return runQuery(
    `MATCH (r:Resource {id: $rid})
     OPTIONAL MATCH (r)-[:IN_SUBJECT|RELATED_TO]-(sib:Resource)
       WHERE sib.id <> r.id AND sib.listed <> false
     WITH r, collect(DISTINCT sib) AS subjectPeers
     OPTIONAL MATCH (r)<-[:OWNS]-(:Student)-[:OWNS]->(owned:Resource)
       WHERE owned.id <> r.id AND owned.listed <> false
     WITH r, subjectPeers, collect(DISTINCT owned) AS ownerPeers
     OPTIONAL MATCH (r)<-[:RECEIVED]-(:Student)-[:RECEIVED|OWNS]->(handed:Resource)
       WHERE handed.id <> r.id AND handed.listed <> false
     WITH subjectPeers, ownerPeers, collect(DISTINCT handed) AS handPeers
     WITH subjectPeers + ownerPeers + handPeers AS peers, subjectPeers, ownerPeers, handPeers
     UNWIND peers AS p
     WITH DISTINCT p, subjectPeers, ownerPeers, handPeers
     WHERE p.listed <> false
     RETURN p.id AS id, p.title AS title, p.category AS category,
            p.semester AS semester, p.listingType AS listingType,
            p.availability AS availability, p.listed AS listed,
            size([x IN subjectPeers WHERE x = p]) * 3
              + size([x IN ownerPeers WHERE x = p]) * 2
              + size([x IN handPeers WHERE x = p]) * 4 AS score,
            size([x IN handPeers WHERE x = p]) > 0 AS sameHands,
            size([x IN subjectPeers WHERE x = p]) > 0 AS sameSubject
     ORDER BY score DESC, title
     LIMIT $limit`,
    { rid: String(resourceId), limit },
    async () => {
      const r = await Resource.findById(resourceId).lean();
      if (!r) return [];
      // Mongo approximation of the same three signals (no traversal available).
      const key = r.subject || r.category;
      const [bySubject, byOwner, byHands] = await Promise.all([
        Resource.find({ _id: { $ne: r._id }, $or: [{ subject: key }, { category: r.category }] })
          .limit(limit).lean(),
        Resource.find({ _id: { $ne: r._id }, ownerId: r.ownerId }).limit(limit).lean(),
        r.receivedFrom
          ? Resource.find({ _id: { $ne: r._id }, receivedFrom: r.receivedFrom }).limit(limit).lean()
          : [],
      ]);
      const scored = new Map();
      const add = (doc, weight, flag) => {
        const id = String(doc._id);
        const entry = scored.get(id) || {
          id, title: doc.title, category: doc.category, semester: doc.semester || null,
          listingType: doc.listingType, availability: doc.availability, listed: doc.isListed !== false,
          score: 0, sameHands: false, sameSubject: false,
        };
        entry.score += weight;
        entry[flag] = true;
        scored.set(id, entry);
      };
      bySubject.forEach((d) => add(d, 3, 'sameSubject'));
      byOwner.forEach((d) => add(d, 2, 'sameSubject'));
      byHands.forEach((d) => add(d, 4, 'sameHands'));
      return [...scored.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    }
  );
}

/**
 * GRAPH side of the custody chain: (Student)-[:GAVE {resourceId}]->(Student).
 * Returns the ordered list of handovers for one item, straight from Neo4j.
 */
export async function getHandoverChain(resourceId) {
  return runQuery(
    `MATCH (giver:Student)-[g:GAVE {resourceId: $rid}]->(receiver:Student)
     RETURN giver.id AS fromId, giver.name AS fromName,
            receiver.id AS toId, receiver.name AS toName,
            g.mode AS mode, g.price AS price, g.at AS at
     ORDER BY g.at`,
    { rid: String(resourceId) },
    async () => {
      // Fallback: MongoDB only remembers the LAST handover.
      const r = await Resource.findById(resourceId).populate('receivedFrom', 'name').lean();
      if (!r || !r.receivedFrom) return [];
      return [{
        fromId: String(r.receivedFrom._id || r.receivedFrom),
        fromName: r.receivedFrom.name || 'previous owner',
        toId: String(r.ownerId),
        toName: 'current owner',
        mode: r.receivedVia || 'donate',
        price: r.price || 0,
        at: r.receivedAt ? new Date(r.receivedAt).toISOString() : null,
      }];
    },
    false,
    'graph fallback: only the most recent handover is available'
  );
}

/** Items that travelled through the same hands (recommendation surface). */
export async function getSameHandsResources(userId, excludeResourceId = null, limit = 10) {
  return runQuery(
    `MATCH (s:Student {id: $uid})-[:RECEIVED|OWNS]->(r:Resource)
     WHERE ($rid IS NULL OR r.id <> $rid) AND r.listed <> false
     RETURN DISTINCT r.id AS id, r.title AS title, r.category AS category,
            r.listingType AS listingType, r.listed AS listed
     ORDER BY title LIMIT $limit`,
    { uid: String(userId), rid: excludeResourceId ? String(excludeResourceId) : null, limit },
    async () => {
      const docs = await Resource.find({ receivedFrom: userId })
        .limit(limit).lean();
      return docs.map((d) => ({
        id: String(d._id), title: d.title, category: d.category,
        listingType: d.listingType, listed: d.isListed !== false,
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

/** Full subgraph for the interactive force-directed visualization.
 * Only listed marketplace items are shown as connected products — unlisted /
 * in-custody items never appear. Subject/Department/Student hubs are kept so
 * the picture reads as a graph, but product nodes are strictly
 * r.listed <> false. */
export async function getGraphData(resourceId, depth = 2) {
  return runQuery(
    `MATCH p=(c:Resource {id:$rid})-[r*1..${depth}]-(n)
     UNWIND relationships(p) AS rel
     WITH DISTINCT rel, startNode(rel) AS a, endNode(rel) AS b
     // drop any edge touching an unlisted product (stale/ghost product link)
     WHERE NOT ((a:Resource AND a.listed = false AND a.id <> $rid)
            OR (b:Resource AND b.listed = false AND b.id <> $rid))
     RETURN a.id AS aId, labels(a)[0] AS aLabel, coalesce(a.title, a.name) AS aName,
            a.listed AS aListed,
            b.id AS bId, labels(b)[0] AS bLabel, coalesce(b.title, b.name) AS bName,
            b.listed AS bListed, type(rel) AS relType`,
    { rid: String(resourceId) },
    async () => {
      const c = await Resource.findById(resourceId).lean();
      if (!c) return { nodes: [], links: [] };
      const key = c.subject || c.category;
      // Neighbours in this subject/category first (listed items only)…
      const primary = await Resource.find({
        _id: { $ne: c._id }, isListed: { $ne: false },
        $or: [{ subject: key }, { category: c.category }],
      }).limit(8).lean();
      // …then top up from the same department so the star is never sparse.
      let related = primary;
      if (related.length < 5) {
        const seen = new Set([String(c._id), ...primary.map((x) => String(x._id))]);
        const more = await Resource.find({ _id: { $nin: [...seen] }, isListed: { $ne: false }, department: c.department })
          .sort({ ratingAvg: -1, createdAt: -1 }).limit(5 - related.length).lean();
        related = [...primary, ...more];
      }
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
 * centerId is threaded through for graph shaping (unlisted-product pruning).
 */
async function runQuery(cypher, params, fallbackFn, raw = false, note = '', centerId = null) {
  try {
    const { run } = await import('./graph.service.js');
    const records = await run(cypher, params);
    // A clean Cypher execution is a Neo4j answer — even when zero rows come
    // back (e.g. an item that was never handed over has an empty chain).
    // Only genuinely failed queries fall through to the Mongo fallback.
    const rows = (records || []).map((rec) => {
      const o = {};
      rec.keys.forEach((k) => { o[k] = typeof rec.get(k)?.toNumber === 'function' ? rec.get(k).toNumber() : rec.get(k); });
      return o;
    });
    if (raw) {
      if (!rows.length) return { source: 'neo4j', data: { nodes: [], links: [] } };
      return { source: 'neo4j', data: shapeGraphData(rows, centerId || params?.rid || null) };
    }
    return { source: 'neo4j', data: rows };
  } catch (err) {
    console.warn('[graph] traversal failed:', err.message);
  }
  await logDbEvent('graph', 'fallback.mongo', note || 'Neo4j unavailable — Mongo fallback query served', {});
  const data = await fallbackFn();
  return { source: 'mongo-fallback', data };
}

function shapeGraphData(rows, centerId = null) {
  const nodes = new Map();
  const links = [];
  rows.forEach((row) => {
    // Never surface an unlisted product as a connected node (mock/ghost data).
    // The centre node itself is always kept so the view never goes blank.
    const keepA = row.aLabel !== 'Resource' || row.aId === centerId || row.aListed !== false;
    const keepB = row.bLabel !== 'Resource' || row.bId === centerId || row.bListed !== false;
    if (!keepA || !keepB) return;
    if (row.aId && !nodes.has(row.aId)) nodes.set(row.aId, { id: row.aId, label: row.aLabel, name: row.aName });
    if (row.bId && !nodes.has(row.bId)) nodes.set(row.bId, { id: row.bId, label: row.bLabel, name: row.bName });
    if (row.aId && row.bId) links.push({ source: row.aId, target: row.bId, relType: row.relType });
  });
  return { nodes: [...nodes.values()], links };
}
