import Resource from '../models/Resource.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import Review from '../models/Review.js';
import { run, resetGraph, graphCounts, verifyNeo4j, syncResourceToGraph } from './graph.service.js';
import { logDbEvent } from './eventlog.service.js';

/**
 * GRAPH PARADIGM — full MongoDB → Neo4j re-sync (idempotent).
 *
 * MongoDB stays the source of truth; this walks every document once and
 * rebuilds the graph so the "Related items" traversal has real edges to walk:
 *
 *   Student -[:OWNS]-> Resource          (current custodian)
 *   Resource -[:IN_SUBJECT]-> Subject -[:BELONGS_TO]-> Department
 *   Resource -[:RELATED_TO]-> Resource   (same-subject peers; explicit edge)
 *   Student -[:GAVE]-> Student           (custody handovers after /donate|/sell)
 *   Student -[:RECEIVED]-> Resource      (who has received this item)
 *   Student -[:USED]-> Resource          (completed / lent deals)
 *   Student -[:REVIEWED]-> Resource      (with ratings)
 *   Student -[:INTERESTED_IN]-> Subject  (derived from reviews)
 *
 * Used by POST /api/graph/sync and `node scripts/graph-sync.mjs`.
 */
export async function seedGraphFromMongo({ wipe = true } = {}) {
  const online = await verifyNeo4j();
  if (!online) {
    const err = new Error(`Neo4j is unreachable at ${process.env.NEO4J_URI || 'bolt://localhost:7687'} — start the database in Neo4j Desktop and retry.`);
    err.status = 503;
    throw err;
  }

  const [users, resources, txs, reviews] = await Promise.all([
    User.find({}, 'name department role').lean(),
    Resource.find({}).lean(),
    Transaction.find({}, 'resource owner borrower type status').lean(),
    Review.find({ targetType: 'resource' }, 'user targetId rating').lean(),
  ]);

  if (wipe) await resetGraph();

  // 1) Students (every user, even those with nothing listed yet).
  if (users.length) {
    await run(
      `UNWIND $rows AS row
       MERGE (s:Student {id: row.id})
       SET s.name = row.name, s.department = row.department, s.role = row.role`,
      {
        rows: users.map((u) => ({
          id: String(u._id),
          name: u.name || 'student',
          department: u.department || '',
          role: u.role || 'student',
        })),
      }
    );
  }

  // 2) Resources (reuses the same MERGE helper the write-paths call).
  const nameById = new Map(users.map((u) => [String(u._id), u.name || 'student']));
  for (const resource of resources) {
    await syncResourceToGraph(resource, nameById.get(String(resource.ownerId)) || '');
  }

  // 3) Explicit RELATED_TO edges for same-subject products (the "related items"
  //    backbone): one edge per unordered pair, id comparison keeps it unique.
  await run(
    `MATCH (a:Resource)-[:IN_SUBJECT]->(s:Subject)<-[:IN_SUBJECT]-(b:Resource)
      WHERE a.id < b.id AND a.listed <> false AND b.listed <> false
      MERGE (a)-[rel:RELATED_TO]->(b)
        ON CREATE SET rel.via = 'subject', rel.subject = s.name`
  );

  // 4) Custody handovers — who gave this item to whom (graph view of the chain).
  const handed = resources.filter((r) => r.receivedFrom && r.receivedAt);
  if (handed.length) {
    await run(
      `UNWIND $rows AS row
       MATCH (r:Resource {id: row.rid})
       MERGE (giver:Student {id: row.fromId})
       MERGE (receiver:Student {id: row.toId})
       MERGE (giver)-[g:GAVE {resourceId: row.rid}]->(receiver)
         ON CREATE SET g.mode = row.mode, g.price = row.price, g.at = row.at
       MERGE (receiver)-[rc:RECEIVED {resourceId: row.rid}]->(r)
         ON CREATE SET rc.mode = row.mode, rc.price = row.price, rc.at = row.at`,
      {
        rows: handed.map((r) => ({
          rid: String(r._id),
          fromId: String(r.receivedFrom),
          toId: String(r.ownerId),
          mode: r.receivedVia || 'donate',
          price: Number(r.price || 0),
          at: new Date(r.receivedAt).toISOString(),
        })),
      }
    );
  }

  // 5) Deal edges — a completed deal means the item was actually used.
  const used = txs.filter((t) => ['completed', 'accepted'].includes(t.status));
  if (used.length) {
    await run(
      `UNWIND $rows AS row
       MATCH (r:Resource {id: row.rid})
       MERGE (s:Student {id: row.uid})
       MERGE (s)-[:USED {type: row.type}]->(r)`,
      {
        rows: used.map((t) => ({
          rid: String(t.resource),
          uid: String(t.borrower),
          type: t.type || 'sell',
        })),
      }
    );
  }

  // 6) Reviews + the interest edges they imply.
  if (reviews.length) {
    await run(
      `UNWIND $rows AS row
       MATCH (r:Resource {id: row.rid})
       MERGE (s:Student {id: row.uid})
       MERGE (s)-[e:REVIEWED]->(r)
         SET e.rating = row.rating
       WITH s, r
       OPTIONAL MATCH (r)-[:IN_SUBJECT]->(sub:Subject)
       FOREACH (x IN CASE WHEN sub IS NULL THEN [] ELSE [1] END |
         MERGE (s)-[:INTERESTED_IN]->(sub))`,
      {
        rows: reviews.map((rv) => ({
          rid: String(rv.targetId),
          uid: String(rv.user),
          rating: Number(rv.rating || 0),
        })),
      }
    );
  }

  const counts = await graphCounts();
  await logDbEvent('graph', 'seed.full',
    `Graph re-synced from MongoDB — ${counts.nodes} node(s), ${counts.relationships} relationship(s)`, counts);
  return {
    source: 'neo4j',
    wiped: wipe,
    mongo: { users: users.length, resources: resources.length, deals: txs.length, reviews: reviews.length },
    ...counts,
  };
}

export default seedGraphFromMongo;
