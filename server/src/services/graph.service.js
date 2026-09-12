import neo4j from 'neo4j-driver';
import { env } from '../config/env.js';
import { logDbEvent } from './eventlog.service.js';

/**
 * GRAPH PARADIGM (Neo4j) — entity sync.
 * MongoDB write operations call these MERGE helpers so key entities stay
 * mirrored in the graph: Student -[:OWNS]-> Resource -[:IN_SUBJECT]-> Subject
 * -[:BELONGS_TO]-> Department, plus REVIEWED / REQUESTED / USED / RELATED_TO edges.
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

async function run(cypher, params = {}) {
  const session = getDriver().session();
  try {
    const res = await session.run(cypher, params);
    return res.records;
  } catch (err) {
    connected = false;
    console.warn('[graph] query failed:', err.message);
    return [];
  } finally {
    await session.close();
  }
}

/** Upsert a Resource + its Student owner + Subject + Department subgraph. */
export async function syncResourceToGraph(resource, ownerName = '') {
  if (!resource) return;
  const params = {
    rid: String(resource._id),
    rtitle: resource.title,
    category: resource.category,
    subject: resource.subject || resource.category,
    department: resource.department || 'General',
    semester: resource.semester || 0,
    ownerId: String(resource.ownerId?._id || resource.ownerId),
    ownerName,
  };
  await run(
    `MERGE (s:Student {id: $ownerId}) SET s.name = $ownerName
     MERGE (r:Resource {id: $rid})
       SET r.title = $rtitle, r.category = $category, r.semester = $semester
     MERGE (sub:Subject {name: $subject})
     MERGE (d:Department {name: $department})
     MERGE (sub)-[:BELONGS_TO]->(d)
     MERGE (s)-[:OWNS]->(r)
     MERGE (r)-[:IN_SUBJECT]->(sub)`,
    { ...params, rtitle: resource.title }
  );
  await logDbEvent('graph', 'node.sync', `Synced "${resource.title}" to graph`, { rid: params.rid });
}

export async function removeResourceFromGraph(rid) {
  await run('MATCH (r:Resource {id: $rid}) DETACH DELETE r', { rid: String(rid) });
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
