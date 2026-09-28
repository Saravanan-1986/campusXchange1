/**
 * GRAPH SMOKE TEST — proves the "Related items" feature really is answered by
 * Neo4j (not the Mongo fallback) and that the custody chain exists as edges.
 *
 *   npm run dev --prefix server           # or just have Neo4j running
 *   node scripts/graph-smoke.mjs
 *
 * Every function below returns { source: 'neo4j' | 'mongo-fallback' }; the test
 * fails when Neo4j answers 'mongo-fallback', which is exactly the regression we
 * want to catch (e.g. a Cypher typo or an unseeded graph).
 */
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import Resource from '../src/models/Resource.js';
import { verifyNeo4j, neo4jStatus, graphCounts } from '../src/services/graph.service.js';
import { seedGraphFromMongo } from '../src/services/graph.seed.js';
import {
  getRelatedResources, getHandoverChain, getSameHandsResources,
  getGraphData, getGraphOverview, getStudentsAlsoUsed,
} from '../src/services/graph.queries.js';

let pass = 0;
let fail = 0;
const check = (label, ok, extra = '') => {
  if (ok) { pass += 1; console.log(`  OK   ${label}`); }
  else { fail += 1; console.error(`  FAIL ${label} ${extra}`); }
};

async function main() {
  await mongoose.connect(env.mongoUri);
  const online = await verifyNeo4j();
  check(`Neo4j reachable (${env.neo4j.uri})`, online, `status=${neo4jStatus()}`);
  if (!online) {
    console.error('[graph-smoke] start Neo4j Desktop (or `neo4j console`) and retry.');
    await mongoose.disconnect();
    process.exit(1);
  }

  const seeded = await seedGraphFromMongo({ wipe: false });
  console.log(`  .. graph: ${seeded.nodes} nodes / ${seeded.relationships} relationships`);
  check('graph has Resource nodes', (seeded.byLabel.find((l) => l.label === 'Resource')?.count || 0) > 0);
  check('graph has OWNS edges', (seeded.byType.find((t) => t.type === 'OWNS')?.count || 0) > 0);
  check('graph has RELATED_TO edges',
    (seeded.byType.find((t) => t.type === 'RELATED_TO')?.count || 0) > 0 || seeded.mongo.resources < 2,
    JSON.stringify(seeded.byType));

  const sample = await Resource.findOne({}).sort({ createdAt: 1 });
  if (!sample) throw new Error('No resources in MongoDB to sample');
  const rid = String(sample._id);
  console.log(`  .. sampling "${sample.title}" (${rid})`);

  const related = await getRelatedResources(rid, 10);
  check(`related items answered by Neo4j (${related.data?.length || 0} hit(s))`, related.source === 'neo4j',
    `source=${related.source}`);

  const data = await getGraphData(rid, 2);
  check(`force-graph subgraph from Neo4j (${data.data?.nodes?.length || 0} node(s))`,
    data.source === 'neo4j' && (data.data?.nodes?.length || 0) > 0, `source=${data.source}`);

  const chain = await getHandoverChain(rid);
  check(`handover chain answered by Neo4j (${chain.data?.length || 0} handover(s))`, chain.source === 'neo4j',
    `source=${chain.source}`);

  const sameHands = await getSameHandsResources(sample.ownerId, rid, 10);
  check(`same-hands traversal from Neo4j (${sameHands.data?.length || 0} hit(s))`, sameHands.source === 'neo4j',
    `source=${sameHands.source}`);

  const overview = await getGraphOverview(20);
  check(`department/subject overview from Neo4j (${overview.data?.length || 0} row(s))`, overview.source === 'neo4j',
    `source=${overview.source}`);

  const alsoUsed = await getStudentsAlsoUsed(rid, null, 10);
  check('collaborative filter answered', !!alsoUsed.source, `source=${alsoUsed.source}`);

  const counts = await graphCounts();
  check('node/edge census readable', counts.nodes > 0, JSON.stringify(counts.byLabel));

  console.log(`\n[graph-smoke] ${pass} passed · ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('[graph-smoke] fatal:', err.message);
  process.exit(1);
});
