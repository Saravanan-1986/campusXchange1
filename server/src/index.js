import http from 'http';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { env } from './config/env.js';
import { connectDatabase } from './config/db.js';
import { initSockets } from './sockets/index.js';
import { verifyNeo4j } from './services/graph.service.js';
import { initChangeStreams } from './services/active/changeStreams.js';
import { initCron } from './services/active/cron.js';
import { errorHandler, notFound } from './middleware/error.js';
import { logDbEvent } from './services/eventlog.service.js';

/**
 * CampusXchange API server.
 * Five database paradigms live here:
 *  - MongoDB   : primary document store (all models in src/models)
 *  - Neo4j     : graph sync + recommendation traversals (src/services/graph.*)
 *  - Temporal  : ResourceHistory validFrom/validTo snapshots (history.service)
 *  - Active DB : Change Streams + node-cron ECA rules (services/active/*)
 *  - Spatial   : 2dsphere + $near/$geoWithin (spatial.routes)
 */
const app = express();

app.use(cors({ origin: env.clientUrl, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(path.resolve(env.uploadDir)));

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
import graphRoutes from './routes/graph.routes.js';
import spatialRoutes from './routes/spatial.routes.js';
import adminRoutes from './routes/admin.routes.js';
import systemRoutes from './routes/system.routes.js';

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/graph', graphRoutes);
app.use('/api/spatial', spatialRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/system', systemRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'CampusXchange API' }));
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
  await verifyNeo4j();
  await initChangeStreams();
  initCron();
  await logDbEvent('mongodb', 'server.boot', 'Server booted — 5 DB paradigms initialized', { port: env.port });
});
