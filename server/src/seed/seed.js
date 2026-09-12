/**
 * Demo seeder — run: npm run seed  (from /server)
 * Wipes collections, then creates students, geo-tagged resources, materials,
 * reviews, transactions (one overdue lend) + history & graph sync.
 * Data arrays live in seed/data.js. Password for every seed user: Passw0rd!
 */
import mongoose from 'mongoose';
import User from '../models/User.js';
import Resource from '../models/Resource.js';
import StudyMaterial from '../models/StudyMaterial.js';
import Transaction from '../models/Transaction.js';
import Review from '../models/Review.js';
import RequestModel from '../models/Request.js';
import ResourceHistory from '../models/ResourceHistory.js';
import Notification from '../models/Notification.js';
import DbEvent from '../models/DbEvent.js';
import Report from '../models/Report.js';
import { connectDatabase } from '../config/db.js';
import { recordResourceState } from '../services/history.service.js';
import { syncResourceToGraph, syncReviewToGraph, syncUsedToGraph } from '../services/graph.service.js';
import { USERS, RESOURCES, MATERIALS, CAMPUS } from './data.js';

async function seed() {
  await connectDatabase();
  await new Promise((r) => setTimeout(r, 1500));
  console.log('[seed] wiping collections…');
  await Promise.all([
    User.deleteMany({}), Resource.deleteMany({}), StudyMaterial.deleteMany({}),
    Transaction.deleteMany({}), Review.deleteMany({}), RequestModel.deleteMany({}),
    ResourceHistory.deleteMany({}), Notification.deleteMany({}), DbEvent.deleteMany({}), Report.deleteMany({}),
  ]);

  const users = [];
  for (const u of USERS) users.push(await User.create({ ...u, password: 'Passw0rd!' }));

  const jitter = (i) => [CAMPUS.lng + 0.002 * i, CAMPUS.lat + 0.0015 * (i % 4)];

  const resources = [];
  for (let i = 0; i < RESOURCES.length; i++) {
    const r = RESOURCES[i];
    const owner = users[r.owner];
    const loc = jitter(i + 1);
    const doc = await Resource.create({
      ...r, ownerId: owner._id, availability: 'available',
      location: { type: 'Point', coordinates: loc, label: `${CAMPUS.label} #${i + 1}` },
      price: r.listingType === 'sell' ? r.price : 0,
    });
    await recordResourceState(doc, { actorLabel: owner.name, source: 'user', summary: 'Listed on marketplace' });
    await syncResourceToGraph(doc, owner.name);
    resources.push(doc);
  }

  // Price-change demo → two temporal versions on one resource
  const os = resources[0];
  os.price = 300;
  await os.save();
  await recordResourceState(os, { actorLabel: users[1].name, source: 'user', fields: ['price'], summary: 'Price 350 → 300 (negotiated)' });

  const materials = [];
  for (const m of MATERIALS) {
    const up = users[m.department === 'Electronics' ? 2 : 1];
    materials.push(await StudyMaterial.create({
      ...m, uploadedBy: up._id,
      file: { filename: 'demo-sample.pdf', originalName: `${m.title}.pdf`, mimeType: 'application/pdf', size: 204800 },
    }));
  }

  // Reviews → aggregates + graph REVIEWED edges
  const reviews = [
    { targetType: 'resource', targetId: resources[0]._id, user: users[2], rating: 5, comment: 'Crisp copy, best price on campus.' },
    { targetType: 'resource', targetId: resources[0]._id, user: users[3], rating: 4, comment: 'Great book, few pencil marks.' },
    { targetType: 'resource', targetId: resources[5]._id, user: users[1], rating: 4, comment: 'Fair condition as described.' },
    { targetType: 'material', targetId: materials[0]._id, user: users[2], rating: 5, comment: 'Saved my midsems!' },
    { targetType: 'material', targetId: materials[1]._id, user: users[1], rating: 4, comment: 'Very useful set.' },
  ];
  for (const rv of reviews) {
    await Review.create(rv);
    await Review.syncAggregates(rv.targetType, rv.targetId);
    if (rv.targetType === 'resource') await syncReviewToGraph(rv.user._id, rv.user.name, rv.targetId, rv.rating);
  }

  // Transactions: completed sell + accepted lend already past due (cron demo)
  const sellTx = await Transaction.create({
    resource: resources[1]._id, owner: users[2]._id, borrower: users[3]._id,
    type: 'sell', price: 550, status: 'completed',
  });
  await syncUsedToGraph(users[3]._id, resources[1]._id);
  const lendTx = await Transaction.create({
    resource: resources[2]._id, owner: users[1]._id, borrower: users[2]._id,
    type: 'lend', status: 'accepted',
    dueDate: new Date(Date.now() - 1000 * 60 * 60 * 26), // 26h ago → cron flags overdue
  });

  // Availability-alert subscription → fires when the tool gets (re)listed
  await RequestModel.create({
    user: users[3]._id, resource: resources[4]._id, type: 'availability-alert',
    message: 'Need it for the workshop lab next week',
  });

  console.log('\n[seed] done. Demo logins (password: Passw0rd!):');
  USERS.forEach((u) => console.log(`   ${u.role.padEnd(7)} ${u.collegeEmail}`));
  console.log(`\n[seed] overdue lend tx ready: ${lendTx._id} (cron flags it within a minute)`);
  console.log(`[seed] completed sell tx: ${sellTx._id}`);
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });
