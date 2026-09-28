/**
 * GRAPH SEED CLI — rebuild Neo4j from MongoDB, then print the census.
 *
 *   npm run graph:sync            # wipe + rebuild
 *   npm run graph:sync -- --no-wipe   # merge without deleting existing nodes
 *
 * Run it once after starting Neo4j Desktop (or any time the graph looks stale)
 * so the "Related items" traversal has real edges to walk.
 */
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { seedGraphFromMongo } from '../src/services/graph.seed.js';
import { getDriver } from '../src/services/graph.service.js';

const wipe = !process.argv.includes('--no-wipe');

async function main() {
  console.log(`[graph:sync] target ${env.neo4j.uri} (wipe: ${wipe})`);
  await mongoose.connect(env.mongoUri);
  console.log(`[graph:sync] MongoDB connected → ${env.mongoUri}`);
  try {
    const result = await seedGraphFromMongo({ wipe });
    console.log(`[graph:sync] nodes: ${result.nodes} · relationships: ${result.relationships}`);
    console.log('[graph:sync] nodes by label:',
      result.byLabel.map((r) => `${r.label}=${r.count}`).join(', ') || '—');
    console.log('[graph:sync] relationships by type:',
      result.byType.map((r) => `${r.type}=${r.count}`).join(', ') || '—');
    console.log('[graph:sync] MongoDB source:', JSON.stringify(result.mongo));
  } finally {
    await getDriver().close().catch(() => {});
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[graph:sync] failed:', err.message);
  process.exit(1);
});
