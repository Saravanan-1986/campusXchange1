import dotenv from 'dotenv';
dotenv.config({ path: new URL('../../.env', import.meta.url) });
dotenv.config();

/**
 * Central env config (server).
 * Every value can be overridden in server/.env — see .env.example.
 *
 * Five database paradigms, three engines:
 *   MongoDB    → document store (primary)
 *   Neo4j      → graph
 *   PostgreSQL → temporal tables + triggers (active DB) + PostGIS/earthdistance (spatial)
 */
export const env = {
  port: parseInt(process.env.PORT || '8044', 10),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/campusxchange',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:6390',
  jwtSecret: process.env.JWT_SECRET || 'campusxchange-dev-secret-change-me',
  jwtExpires: process.env.JWT_EXPIRES || '7d',
  neo4j: {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    user: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'campusxchange',
  },
  /** PostgreSQL — temporal + active(triggers) + spatial(PostGIS) layer. */
  pg: {
    host: process.env.PG_HOST || '127.0.0.1',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD ?? '',
    database: process.env.PG_DATABASE || 'campusxchange',
    adminDatabase: process.env.PG_ADMIN_DATABASE || 'postgres',
    poolMax: parseInt(process.env.PG_POOL_MAX || '10', 10),
    ssl: process.env.PG_SSL === 'true',
  },
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '10', 10),
  adminEmail: process.env.ADMIN_EMAIL || 'admin@campusxchange.edu',
  collegeEmailDomains: (process.env.COLLEGE_EMAIL_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
  reportAutoFlagThreshold: parseInt(process.env.REPORT_AUTOFLAG_THRESHOLD || '3', 10),
  /** Beyond which a lend is considered overdue by the SQL active layer (hours). */
  lendGraceHours: parseInt(process.env.LEND_GRACE_HOURS || '0', 10),
  isDev: process.env.NODE_ENV !== 'production',
};

/** True when the PG layer is configured at all (always true; kept for feature flags). */
export const pgEnabled = process.env.PG_ENABLED !== 'false';

