import neo4j from 'neo4j-driver';
import { env } from '../config/env.js';
import { logDbEvent } from './eventlog.service.js';

/**
 * GRAPH PARADIGM (Neo4j) — entity sync.
 * MongoDB write operations call these MERGE helpers so key entities stay
 * mirrored in the graph:
 *
 *   (Student)-[:OWNS]->(Resource)-[:IN_SUBJECT]->(Subject)-[:BELONGS_TO]->(Department)
 *   (Student)-[:REVIEWED {rating}]->(Resource)
 *   (Student)-[:USED|REQUESTED]->(Resource)
 *   (Resource)-[:RELATED_TO {via}]-(Resource)
 *   (Student)-[:GAVE {mode,price,at}]->(Student)-[:RECEIVED {…}]->(Resource)
 *
 * The last pair is the item's CUSTODY CHAIN — who handed this product to whom
 * after a /donate or /sell in chat — and powers both "related items" discovery
 * and the previous-owners panel on the listing page.
 */
let driver = null;
let connected = false;

export function getDriver() {
  if (!driver) {
    driver = neo4j.driver(env.neo4j.uri, neo4j.auth.basic(env.neo4j.user, env.neo4j.password), {
      connectionTimeout: 4000,
    });
  }
  return driver;
}

export async function verifyNeo4j() {
  try {
    const s = getDriver().session();
    await s.run('RETURN 1');
    await s.close();
    connected = true;
    console.log('[graph] Neo4j connected');
  } catch (err) {
    connected = false;
    console.warn('[graph] Neo4j unreachable — recommendations will fall back to Mongo:', err.message);
  }
  return connected;
}

export function neo4jStatus() { return connected ? 'connected' : 'unavailable'; }

export async function run(cypher, params = {}) {
  // neo4j-driver v6 sends JS numbers as Float; Cypher LIMIT requires Integer.
  // Normalise any limit-ish param to an Integer so `LIMIT $limit` works.
  const fixed = { ...params };
  for (const k of Object.keys(fixed)) {
    if (/limit/i.test(k) && typeof fixed[k] === 'number') {
      fixed[k] = neo4j.int(Math.trunc(fixed[k]));
    }
  }
  const session = getDriver().session();
  try {
    const res = await session.run(cypher, fixed);
    return res.records;
  } catch (err) {
    connected = false;
    console.warn('[graph] query failed:', err.message);
    throw err;
  } finally {
    await session.close();
  }
}


/**
 * Upsert a Resource + its Student owner + Subject + Department subgraph.
 * Also refreshes the marketplace flags the graph queries filter on and moves
 * the OWNS edge when the item changed hands.
 */
export async function syncResourceToGraph(resource, ownerName = '') {
  if (!resource) return;
  const ownerId = String(resource.ownerId?._id || resource.ownerId || '');
  if (!ownerId) return;
  const params = {
    rid: String(resource._id),
    rtitle: resource.title || 'Untitled',
    category: resource.category || 'other',
    subject: resource.subject || resource.category || 'General',
    department: resource.department || 'General',
    semester: resource.semester || 0,
    price: Number(resource.price || 0),
    listingType: resource.listingType || 'sell',
    availability: resource.availability || 'available',
    listed: resource.isListed !== false,
    ownerId,
    ownerName,
  };
  await run(
    `MERGE (s:Student {id: $ownerId}) SET s.name = $ownerName
     MERGE (r:Resource {id: $rid})
       SET r.title = $rtitle, r.category = $category, r.semester = $semester,
           r.subject = $subject, r.department = $department, r.price = $price,
           r.listingType = $listingType, r.availability = $availability,
           r.listed = $listed, r.ownerId = $ownerId
     MERGE (sub:Subject {name: $subject})
     MERGE (d:Department {name: $department})
     MERGE (sub)-[:BELONGS_TO]->(d)
     MERGE (r)-[:IN_SUBJECT]->(sub)
     WITH r, s
     OPTIONAL MATCH (other:Student)-[stale:OWNS]->(r) WHERE other.id <> $ownerId
     WITH r, s, collect(stale) AS staleRels
     FOREACH (rel IN staleRels | DELETE rel)
     MERGE (s)-[:OWNS]->(r)`,
    params
  );
  await logDbEvent('graph', 'node.sync', `Synced "${params.rtitle}" to graph`, { rid: params.rid });
}

/** Marketplace visibility is a graph property too (listed / pulled off). */
export async function syncListingStateToGraph(resourceId, listed) {
  await run('MATCH (r:Resource {id: $rid}) SET r.listed = $listed', {
    rid: String(resourceId),
    listed: listed !== false,
  });
}

/**
 * Record a HANDOVER in the graph: (giver)-[:GAVE]->(receiver) plus
 * (receiver)-[:RECEIVED]->(item). The OWNS edge moves to the new student and
 * the item leaves the marketplace (listed = false) until it is re-listed.
 *
 * These edges are what make "students who had this product also had …"
 * traversals possible — the graph-side view of the custody chain.
 */
export async function syncTransferToGraph({ fromUserId, toUserId, resourceId, mode = 'donate', price = 0, at = null }) {
  if (!fromUserId || !toUserId || !resourceId) return;
  const params = {
    fromId: String(fromUserId),
    toId: String(toUserId),
    rid: String(resourceId),
    mode,
    price: Number(price || 0),
    at: at ? new Date(at).toISOString() : new Date().toISOString(),
  };
  await run(
    `MATCH (r:Resource {id: $rid})
     MERGE (giver:Student {id: $fromId})
     MERGE (receiver:Student {id: $toId})
     WITH r, giver, receiver
     OPTIONAL MATCH (giver)-[old:OWNS]->(r)
     WITH r, giver, receiver, collect(old) AS oldOwns
     FOREACH (rel IN oldOwns | DELETE rel)
     MERGE (receiver)-[:OWNS]->(r)
     SET r.listed = false, r.ownerId = $toId, r.listingType = $mode, r.price = $price
     CREATE (giver)-[:GAVE {resourceId: $rid, mode: $mode, price: $price, at: $at}]->(receiver)
     CREATE (receiver)-[:RECEIVED {resourceId: $rid, mode: $mode, price: $price, at: $at}]->(r)`,
    params
  );
  await logDbEvent('graph', 'edge.handover',
    `Handover edge ${mode} → receiver ${params.toId.slice(-6)}`, { rid: params.rid, price: params.price });
}

export async function removeResourceFromGraph(rid) {
  await run('MATCH (r:Resource {id: $rid}) DETACH DELETE r', { rid: String(rid) });
}

/** Node / relationship census for the DB monitor + graph status endpoint. */
export async function graphCounts() {
  const [labelRecs, relRecs, totalRecs] = await Promise.all([
    run('MATCH (n) RETURN labels(n)[0] AS label, count(*) AS count ORDER BY count DESC'),
    run('MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS count ORDER BY count DESC'),
    run('MATCH (n) WITH count(n) AS nodes CALL { MATCH ()-[r]->() RETURN count(r) AS rels } RETURN nodes, rels'),
  ]);
  const rows = (recs) => recs.map((rec) => {
    const o = {};
    rec.keys.forEach((k) => { o[k] = rec.get(k); });
    return o;
  });
  // Cypher counts come back as Neo4j Integers — normalise them.
  const num = (v) => (v && typeof v.toNumber === 'function' ? v.toNumber() : Number(v || 0));
  const total = rows(totalRecs)[0] || {};
  return {
    nodes: num(total.nodes),
    relationships: num(total.rels),
    byLabel: rows(labelRecs).map((r) => ({ ...r, count: num(r.count) })),
    byType: rows(relRecs).map((r) => ({ ...r, count: num(r.count) })),
  };
}

/** Drop the whole graph (used by the full Mongo → Neo4j re-sync). */
export async function resetGraph() {
  await run('MATCH (n) DETACH DELETE n');
}

export async function syncReviewToGraph(userId, userName, resourceId, rating) {
  await run(
    `MERGE (s:Student {id: $uid}) SET s.name = $name
     MERGE (r:Resource {id: $rid})
     MERGE (s)-[e:REVIEWED]->(r)
     SET e.rating = $rating
     WITH s, r
     OPTIONAL MATCH (r)-[:IN_SUBJECT]->(sub)
     WITH s, sub WHERE sub IS NOT NULL
     MERGE (s)-[:INTERESTED_IN]->(sub)`,
    { uid: String(userId), name: userName, rid: String(resourceId), rating }
  );
}

export async function syncUsedToGraph(userId, resourceId) {
  await run(
    `MERGE (s:Student {id: $uid})
     MERGE (r:Resource {id: $rid})
     MERGE (s)-[:USED]->(r)`,
    { uid: String(userId), rid: String(resourceId) }
  );
}

export async function syncRequestToGraph(userId, userName, resourceId) {
  await run(
    `MERGE (s:Student {id: $uid}) SET s.name = $name
     MERGE (r:Resource {id: $rid})
     MERGE (s)-[:REQUESTED]->(r)`,
    { uid: String(userId), name: userName, rid: String(resourceId) }
  );
}
