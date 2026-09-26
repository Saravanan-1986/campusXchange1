/**
 * PostgreSQL migration runner.
 *
 *   npm run db:migrate        apply every pending file in src/db/migrations
 *   npm run db:reset          DROP SCHEMA public CASCADE, then re-apply (dev only)
 *
 * Files are applied in filename order inside a transaction each, and recorded
 * in schema_migration, so re-running is always safe (the SQL itself is also
 * written idempotently with IF NOT EXISTS / CREATE OR REPLACE).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { env } from '../config/env.js';
import { ensureDatabase, closePool } from '../config/pg.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const { Client } = pg;

const RESET = process.argv.includes('--reset');

function clientConfig() {
  return {
    host: env.pg.host,
    port: env.pg.port,
    user: env.pg.user,
    password: env.pg.password === '' ? undefined : env.pg.password,
    database: env.pg.database,
    connectionTimeoutMillis: 8_000,
  };
}

async function main() {
  console.log(`[migrate] target postgres://${env.pg.user}@${env.pg.host}:${env.pg.port}/${env.pg.database}`);
  const created = await ensureDatabase();
  if (created) console.log(`[migrate] database "${env.pg.database}" created`);

  const client = new Client(clientConfig());
  client.on('notice', (n) => console.log(`[pg notice] ${n.message}`));
  await client.connect();

  try {
    if (RESET) {
      console.log('[migrate] --reset → dropping schema public (destructive, dev only)');
      await client.query('DROP SCHEMA IF EXISTS public CASCADE');
      await client.query('CREATE SCHEMA public');
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        version    text PRIMARY KEY,
        checksum   text,
        applied_at timestamptz NOT NULL DEFAULT now(),
        duration_ms integer
      )`);

    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    const applied = new Set((await client.query('SELECT version FROM schema_migration')).rows.map((r) => r.version));

    let count = 0;
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = crypto.createHash('sha1').update(sql).digest('hex').slice(0, 12);
      if (applied.has(file) && !RESET) {
        console.log(`[migrate] = ${file} (already applied)`);
        continue;
      }
      const started = Date.now();
      process.stdout.write(`[migrate] + ${file} … `);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        const ms = Date.now() - started;
        await client.query(
          `INSERT INTO schema_migration (version, checksum, duration_ms) VALUES ($1, $2, $3)
           ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum,
                                               applied_at = now(),
                                               duration_ms = EXCLUDED.duration_ms`,
          [file, checksum, ms]
        );
        await client.query('COMMIT');
        console.log(`ok (${ms} ms)`);
        count += 1;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`\n[migrate] FAILED in ${file}:\n  ${err.message}`);
        process.exitCode = 1;
        break;
      }
    }

    const summary = await client.query(`
      SELECT (SELECT count(*) FROM schema_migration) AS migrations,
             (SELECT count(*) FROM pg_stat_user_tables WHERE schemaname = 'public') AS tables,
             (SELECT count(*) FROM pg_trigger t
                JOIN pg_class c ON c.oid = t.tgrelid
               WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace) AS triggers,
             CASE WHEN to_regprocedure('cx_spatial_provider()') IS NOT NULL
                  THEN cx_spatial_provider() ELSE 'not installed yet' END AS spatial`);
    const s = summary.rows[0];
    console.log(`[migrate] done — ${count} applied this run · ${s.migrations} tracked · ${s.tables} tables · ${s.triggers} triggers · spatial: ${s.spatial}`);
  } finally {
    await client.end();
    await closePool();
  }
}

main().catch((err) => {
  console.error('[migrate] fatal:', err.message);
  process.exit(1);
});
