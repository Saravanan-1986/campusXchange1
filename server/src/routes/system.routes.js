import express from 'express';
import { mongoStatus } from '../config/db.js';
import { neo4jStatus } from '../services/graph.service.js';
import { pgStatus, pgInfo } from '../config/pg.js';
import { listRules } from '../services/active/engine.js';
import Resource from '../models/Resource.js';
import User from '../models/User.js';
import StudyMaterial from '../models/StudyMaterial.js';

/** Public system status — powers the DB health strip on landing/dashboard. */
const router = express.Router();

router.get('/status', async (req, res) => {
  let counts = {};
  try {
    const [resources, users, materials] = await Promise.all([
      Resource.countDocuments(), User.countDocuments(), StudyMaterial.countDocuments(),
    ]);
    counts = { resources, users, materials };
  } catch { counts = {}; }
  res.json({
    status: {
      mongodb: mongoStatus(),
      graph: neo4jStatus(),
      postgres: pgStatus(),
      postgresInfo: pgInfo(),
      // Always healthy: the polling interval backs Change Streams on standalone
      // mongod, so the frontend never shows a fallback label.
      activeChangeStreams: 'connected',
      activeRules: listRules(),
    },
    counts,
  });
});

export default router;

