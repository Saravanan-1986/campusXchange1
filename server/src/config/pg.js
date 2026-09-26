import pg from 'pg';
import { env } from './env.js';

/**
 * POSTGRESQL LAYER (paradigms 3, 4 and 5 of the showcase)
 *   TEMPORAL → SQL:2011 valid-time tables (resource_version, lend_period)
 *   ACTIVE   → PL/pgSQL triggers + active_event outbox + pg_notify / LISTEN
 *   SPATIAL  → PostGIS when installed, otherwise cube + earthdistance (GiST)
 *
 * One pooled connection set for queries + one dedicated client for LISTEN
 * (a LISTEN connection can never be returned to the pool).
 */
const { Pool } = pg;

// numeric → JS number is lossy for money; keep NUMERIC as string and convert in
// the row mappers instead. Date/timestamp parsing stays with the driver (timestamptz → Date).
let pool = null;
let listenerClient = null;
let status = 'disconnected';
let serverVersion = null;
let spatialProvider = null;   // 'postgis' | 'earthdistance' | 'bbox'
let postgresExtensions = [];

export function getPool() {
  if (!pool) {
    pool = new Pool({
      host: env.pg.host,
      port: env.pg.port,
      user: env.pg.user,
      password: env.pg.password === '' ? undefined : env.pg.password,
      database: env.pg.database,
      max: env.pg.poolMax,
      ssl: env.pg.ssl ? { rejectUnauthorized: false } : undefined,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: 'campusxchange-api',
    });
    pool.on('error', (err) => {
      console.error('[pg] idle client error:', err.message);
      status = 'error';
    });
  }
  return pool;
}

/**
 * Run a query with parameters. Returns the pg Result.
 * `label` is only used for error context (keeps logs readable during the viva).
 */
export async function query(text, params = [], label = 'query') {
  try {
    const res = await getPool().query(text, params);
    return res;
  } catch (err) {
    console.error(`[pg] ${label} failed:`, err.message);
    throw err;
  }
}

/** Query returning rows only. */
export async function rows(text, params = [], label = 'query') {
  const res = await query(text, params, label);
  return res.rows;
}

/** Single-row helper. */
export async function row(text, params = [], label = 'query') {
  const res = await query(text, params, label);
  return res.rows[0] || null;
}

/** Run a set of statements inside one transaction (BEGIN/COMMIT/ROLLBACK). */
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

/** Create the database if it does not exist (dev convenience; needs an admin db). */
export async function ensureDatabase() {
  const { Client } = pg;
  const admin = new Client({
    host: env.pg.host,
    port: env.pg.port,
    user: env.pg.user,
    password: env.pg.password === '' ? undefined : env.pg.password,
    database: env.pg.adminDatabase,
    connectionTimeoutMillis: 5_000,
  });
  await admin.connect();
  try {
    const { rows: found } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [env.pg.database]);
    if (!found.length) {
      // Identifier cannot be parameterised — the name comes from config, quote it.
      await admin.query(`CREATE DATABASE "${env.pg.database.replace(/"/g, '""')}"`);
      return true;
    }
    return false;
  } finally {
    await admin.end();
  }
}

/** Connect + detect the spatial provider (PostGIS > earthdistance > bbox math). */
export async function connectPostgres() {
  try {
    const info = await row('SELECT version() AS version, current_database() AS db', [], 'connect');
    serverVersion = info.version;
    postgresExtensions = (await rows(
      `SELECT extname, extversion FROM pg_extension ORDER BY extname`, [], 'extension-list'
    )).map((r) => ({ name: r.extname, version: r.extversion }));

    const has = (n) => postgresExtensions.some((e) => e.name === n);
    spatialProvider = has('postgis') ? 'postgis' : has('earthdistance') ? 'earthdistance' : 'bbox';

    status = 'connected';
    console.log(`[pg] PostgreSQL connected → ${info.db} (spatial provider: ${spatialProvider})`);
    return true;
  } catch (err) {
    status = 'unavailable';
    console.warn('[pg] PostgreSQL unreachable — temporal/active/spatial SQL layer degraded:', err.message);
    console.warn('[pg] Fix: check PG_HOST/PG_PORT/PG_USER in server/.env, then  npm run db:migrate');
    return false;
  }
}

export function pgStatus() {
  return status;
}

export function pgInfo() {
  return {
    status,
    version: serverVersion ? serverVersion.split(' ').slice(0, 2).join(' ') : null,
    database: env.pg.database,
    host: `${env.pg.host}:${env.pg.port}`,
    spatialProvider,
    extensions: postgresExtensions,
  };
}

export function getSpatialProvider() {
  return spatialProvider || 'bbox';
}

export function setSpatialProvider(p) {
  spatialProvider = p;
}

/**
 * Dedicated LISTEN connection (ACTIVE DB paradigm).
 * PostgreSQL pushes NOTIFY payloads to us; the API never polls for them.
 */
export async function getListenerClient() {
  if (listenerClient) return listenerClient;
  listenerClient = await getPool().connect();
  listenerClient.on('error', (err) => {
    console.error('[pg] listener connection error:', err.message);
    listenerClient = null;
  });
  return listenerClient;
}

export async function closeListener() {
  if (listenerClient) {
    try { await listenerClient.query('UNLISTEN *'); } catch { /* ignore */ }
    listenerClient.release();
    listenerClient = null;
  }
}

export async function closePool() {
  await closeListener();
  if (pool) {
    await pool.end();
    pool = null;
    status = 'disconnected';
  }
}
