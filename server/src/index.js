import http from 'http';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { env } from './config/env.js';
import { connectDatabase } from './config/db.js';
import { connectPostgres, pgInfo, pgStatus } from './config/pg.js';
import { initSockets } from './sockets/index.js';
import { verifyNeo4j } from './services/graph.service.js';
import { initChangeStreams } from './services/active/changeStreams.js';
import { initCron } from './services/active/cron.js';
import { initActiveListener } from './services/pg/listener.service.js';
import { securityHeaders, rateLimit } from './middleware/security.js';
import { errorHandler, notFound } from './middleware/error.js';
import { logDbEvent } from './services/eventlog.service.js';

/**
 * CampusXchange API server.
 *
 * Five database paradigms on three engines:
 *  - MongoDB     : primary document store (everything in src/models)
 *  - Neo4j       : relationships + recommendations (src/services/graph.*)
 *  - PostgreSQL  : TEMPORAL  (resource_version valid-time tables, lend_period ranges)
 *                  ACTIVE    (PL/pgSQL triggers → active_event outbox → pg_notify → LISTEN)
 *                  SPATIAL   (PostGIS when installed, else cube + earthdistance)
 *                  + full-text search (tsvector/GIN), analytics, introspection
 */
const app = express();

app.use(securityHeaders);
app.use(cors({ origin: env.clientUrl, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(path.resolve(env.uploadDir)));
app.use('/api', rateLimit({ windowMs: 60_000, max: 600, keyPrefix: 'api' }));

// Routes
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/users.routes.js';
import resourceRoutes from './routes/resource.routes.js';
import materialRoutes from './routes/material.routes.js';
import transactionRoutes from './routes/transaction.routes.js';
import requestRoutes from './routes/request.routes.js';
import reviewRoutes from './routes/review.routes.js';
import reportRoutes from './routes/report.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import messageRoutes from './routes/message.routes.js';
import graphRoutes from './routes/graph.routes.js';
import spatialRoutes from './routes/spatial.routes.js';
import temporalRoutes from './routes/temporal.routes.js';
import activeRoutes from './routes/active.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import searchRoutes from './routes/search.routes.js';
import adminRoutes from './routes/admin.routes.js';
import systemRoutes from './routes/system.routes.js';

app.use('/api/auth', rateLimit({ windowMs: 60_000, max: 40, keyPrefix: 'auth' }), authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/graph', graphRoutes);
app.use('/api/spatial', spatialRoutes);   // SPATIAL   — PostgreSQL (PostGIS/earthdistance)
app.use('/api/temporal', temporalRoutes); // TEMPORAL  — PostgreSQL valid-time tables
app.use('/api/active', activeRoutes);     // ACTIVE    — PostgreSQL triggers + ECA registry
app.use('/api/analytics', analyticsRoutes);
app.use('/api/search', searchRoutes);     // hybrid: PG full-text → MongoDB documents
app.use('/api/admin', adminRoutes);
app.use('/api/system', systemRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'CampusXchange API', postgres: pgInfo() }));
app.use(notFound);
app.use(errorHandler);

const server = http.createServer(app);
initSockets(server);

// Friendly failure when the port is already taken (no scary stack dump).
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[api] Port ${env.port} is already in use — another CampusXchange process is running.`);
    console.error('[api] Fix:  netstat -ano | findstr :8044  → then  Stop-Process -Id <PID> -Force  → rerun.');
    process.exit(1);
  }
  throw err;
});

server.listen(env.port, async () => {
  console.log(`[api] CampusXchange API listening on http://localhost:${env.port}`);
  await connectDatabase();
  await connectPostgres();
  await initActiveListener();     // ACTIVE: LISTEN cx_active (database → Socket.io)
  await verifyNeo4j();
  await initChangeStreams();
  initCron();
  await logDbEvent('mongodb', 'server.boot', 'Server booted — 5 DB paradigms initialized', {
    mongodb: 'connected', neo4j: 'optional', postgres: pgStatus(),
    spatial: pgInfo().spatialProvider,
  });
});

