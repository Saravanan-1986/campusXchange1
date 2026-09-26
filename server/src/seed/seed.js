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
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { connectDatabase } from '../config/db.js';
import { connectPostgres, query } from '../config/pg.js';
import { recordResourceState } from '../services/history.service.js';
import { syncResourceToGraph, syncReviewToGraph, syncUsedToGraph } from '../services/graph.service.js';
import {
  syncUserToPostgres,
  syncResourceToPostgres,
  syncTransactionToPostgres,
  wipeMirrors,
} from '../services/pg/sync.service.js';
import { backdateVersion, recordLendPeriod } from '../services/pg/temporal.service.js';
import { upsertZone } from '../services/pg/spatial.service.js';
import { USERS, RESOURCES, MATERIALS, CAMPUS } from './data.js';

// Campus zones for spatial queries
const ZONES = [
  { zoneId: 'lib-main', name: 'Central Library (1st Fl)', kind: 'library', lat: CAMPUS.lat + 0.0010, lon: CAMPUS.lng + 0.0012, capacity: 250 },
  { zoneId: 'cs-block', name: 'Computer Science Dept — Lab 3', kind: 'department', lat: CAMPUS.lat - 0.0014, lon: CAMPUS.lng - 0.0008, capacity: 120 },
  { zoneId: 'ece-block', name: 'Electronics & Comm. Block', kind: 'department', lat: CAMPUS.lat - 0.0022, lon: CAMPUS.lng + 0.0025, capacity: 140 },
  { zoneId: 'main-canteen', name: 'Main Canteen / Food Court', kind: 'canteen', lat: CAMPUS.lat + 0.0025, lon: CAMPUS.lng - 0.0018, capacity: 400 },
  { zoneId: 'boys-hostel-3', name: 'Boys Hostel Block 3', kind: 'hostel', lat: CAMPUS.lat + 0.0040, lon: CAMPUS.lng + 0.0035, capacity: 300 },
  { zoneId: 'girls-hostel-1', name: 'Girls Hostel Block 1', kind: 'hostel', lat: CAMPUS.lat - 0.0038, lon: CAMPUS.lng - 0.0030, capacity: 300 },
  { zoneId: 'sports-arena', name: 'Sports Complex & Grounds', kind: 'sports', lat: CAMPUS.lat + 0.0045, lon: CAMPUS.lng - 0.0040, capacity: 500 },
  { zoneId: 'admin-gate', name: 'Admin Gate (Main Entrance)', kind: 'gate', lat: CAMPUS.lat, lon: CAMPUS.lng, capacity: 50 },
];

async function seedPostgresZones() {
  console.log('[seed:postgres] populating campus zones…');
  for (const z of ZONES) {
    try {
      await upsertZone(z);
    } catch (err) {
      console.warn(`[seed:postgres] zone ${z.zoneId} notice:`, err.message);
    }
  }
}

async function seed() {
  console.log('='.repeat(60));
  console.log('  CampusXchange Seed — 5-Database Paradigm Demo Data');
  console.log('='.repeat(60));

  await connectDatabase();
  await connectPostgres();
  await new Promise((r) => setTimeout(r, 1000));

  console.log('[seed:mongo] wiping collections…');
  await Promise.all([
    User.deleteMany({}), Resource.deleteMany({}), StudyMaterial.deleteMany({}),
    Transaction.deleteMany({}), Review.deleteMany({}), RequestModel.deleteMany({}),
    ResourceHistory.deleteMany({}), Notification.deleteMany({}), DbEvent.deleteMany({}),
    Report.deleteMany({}), Conversation.deleteMany({}), Message.deleteMany({}),
  ]);

  // Wipe PG mirrors via the canonical helper (correct table list + rule reset).
  await wipeMirrors();

  await seedPostgresZones();

  console.log('[seed] creating users…');
  const users = [];
  for (let i = 0; i < USERS.length; i++) {
    const u = USERS[i];
    const loc = {
      type: 'Point',
      coordinates: [CAMPUS.lng + 0.001 * (i - 1.5), CAMPUS.lat + 0.0008 * (i - 1)],
      label: `Near ${ZONES[i % ZONES.length].name}`,
    };
    const userDoc = await User.create({ ...u, password: 'Passw0rd!', location: loc });
    users.push(userDoc);
    await syncUserToPostgres(userDoc);
  }

  const jitter = (i) => [CAMPUS.lng + 0.0015 * i, CAMPUS.lat + 0.0012 * (i % 4)];

  console.log('[seed] creating resources…');
  const resources = [];
  for (let i = 0; i < RESOURCES.length; i++) {
    const r = RESOURCES[i];
    const owner = users[r.owner];
    const loc = jitter(i + 1);
    const doc = await Resource.create({
      ...r,
      ownerId: owner._id,
      availability: 'available',
      location: { type: 'Point', coordinates: loc, label: `${CAMPUS.label} #${i + 1}` },
      price: r.listingType === 'sell' ? r.price : 0,
    });
    await recordResourceState(doc, { actorLabel: owner.name, source: 'user', summary: 'Listed on marketplace' });
    await syncResourceToGraph(doc, owner.name);
    await syncResourceToPostgres(doc, { actorLabel: owner.name, reason: 'Listed on marketplace' });
    resources.push(doc);
  }
  // 3. Temporal time-travel demo: simulate backdated history on resource #0
  console.log('[seed:temporal] simulating backdated resource versions…');
  const os = resources[0];
  const t0 = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  const t1 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  // NOTE: the 2nd backdated version stays open-ended ([t1, ∞)) so the price-300
  // sync below closes it via the mirror trigger → 3 adjacent versions, no gap.

  try {
    await backdateVersion(os._id, {
      title: os.title,
      category: os.category,
      condition: 'good',
      price: 450,
      availability: 'available',
      listingType: 'sell',
      ownerId: String(os.ownerId),
      ownerLabel: users[1].name,
      actorLabel: users[1].name,
      validFrom: t0,
      validTo: t1,
      reason: 'Initial semester listing at ₹450',
    });

    await backdateVersion(os._id, {
      title: os.title,
      category: os.category,
      condition: 'good',
      price: 380,
      availability: 'available',
      listingType: 'sell',
      ownerId: String(os.ownerId),
      ownerLabel: users[1].name,
      actorLabel: users[1].name,
      validFrom: t1,
      validTo: null,
      reason: 'Mid-semester price drop to ₹380',
    });
    console.log('[seed:temporal] backdated 2 versions for Galvin OS book');
  } catch (err) {
    console.warn('[seed:temporal] backdate notice:', err.message);
  }

  os.price = 300;
  await os.save();
  await recordResourceState(os, { actorLabel: users[1].name, source: 'user', fields: ['price'], summary: 'Price 380 → 300' });
  await syncResourceToPostgres(os, { actorLabel: users[1].name, reason: 'Final price 300' });

  // 4. Study Materials
  console.log('[seed] creating study materials…');
  const materials = [];
  for (const m of MATERIALS) {
    const up = users[m.department === 'Electronics' ? 2 : 1];
    materials.push(await StudyMaterial.create({
      ...m,
      uploadedBy: up._id,
      file: { filename: 'demo-sample.pdf', originalName: `${m.title}.pdf`, mimeType: 'application/pdf', size: 204800 },
    }));
  }

  // 5. Reviews
  console.log('[seed] creating reviews…');
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
  // 6. Transactions + GiST exclusion constraint demo
  console.log('[seed:transactions] creating transactions…');
  const sellTx = await Transaction.create({
    resource: resources[1]._id,
    owner: users[2]._id,
    borrower: users[3]._id,
    type: 'sell',
    price: 550,
    status: 'completed',
  });
  await syncUsedToGraph(users[3]._id, resources[1]._id);
  await syncTransactionToPostgres(sellTx);

  const pastDue = new Date(Date.now() - 1000 * 60 * 60 * 26);
  const lendStart1 = new Date(Date.now() - 1000 * 60 * 60 * 24 * 7);
  const lendTx = await Transaction.create({
    resource: resources[2]._id,
    owner: users[1]._id,
    borrower: users[2]._id,
    type: 'lend',
    status: 'accepted',
    dueDate: pastDue,
  });
  resources[2].availability = 'lent';
  await resources[2].save();
  await syncResourceToPostgres(resources[2], { actorLabel: 'seeder', reason: 'Lent out (seed)' });
  await syncTransactionToPostgres(lendTx);

  try {
    await recordLendPeriod({
      resourceId: resources[2]._id,
      borrowerId: users[2]._id,
      borrowerLabel: users[2].name,
      lendStart: lendStart1,
      lendEnd: pastDue,
    });
    console.log('[seed:temporal] recorded active lend_period (GiST exclusion protected)');
  } catch (err) {
    console.warn('[seed:temporal] lend_period notice:', err.message);
  }

  // 7. Request & Messages
  console.log('[seed] creating sample request and conversation…');
  await RequestModel.create({
    user: users[3]._id,
    resource: resources[4]._id,
    type: 'availability-alert',
    message: 'Need it for the workshop lab next week',
  });

  const pairKey = [String(users[1]._id), String(users[2]._id)].sort().join('::');
  const convo = await Conversation.create({
    participants: [users[1]._id, users[2]._id],
    pairKey,
    resource: resources[4]._id,
    subject: resources[4].title,
    lastMessageAt: new Date(),
    lastMessagePreview: 'Sounds great, I can meet at the CS lab tomorrow at 4pm!',
    lastSender: users[2]._id,
    unread: { [String(users[1]._id)]: 1 },
  });
  await Message.create([
    { conversation: convo._id, sender: users[2]._id, body: 'Hi Aisha, is the soldering station still available?', readBy: [users[1]._id, users[2]._id] },
    { conversation: convo._id, sender: users[1]._id, body: 'Yes! It has 3 tips included. When do you need it?', readBy: [users[1]._id, users[2]._id] },
    { conversation: convo._id, sender: users[2]._id, body: 'Sounds great, I can meet at the CS lab tomorrow at 4pm!', readBy: [users[2]._id] },
  ]);

  console.log('\n' + '='.repeat(60));
  console.log('  Seed completed successfully!');
  console.log('='.repeat(60));
  console.log('Demo accounts (password for all: Passw0rd!):');
  USERS.forEach((u) => console.log(`   ${u.role.padEnd(8)} ${u.collegeEmail.padEnd(28)} (${u.name})`));
  console.log('\nKey scenarios ready to demo:');
  console.log(' 1. Temporal Time-Travel : Galvin OS book has 3 versions spanning 60 days');
  console.log(' 2. GiST Double-Lend Def : Lab kit is lent; Postgres rejects overlapping periods');
  console.log(' 3. Spatial Campus Map   : 8 campus zones + listings tagged with distances');
  console.log(' 4. Active Outbox/Triggers: pg_notify("cx_active") fires on all mutations');
  console.log(' 5. Full-Text Search     : tsvector index covers titles + descriptions + tags');
  console.log(' 6. Overdue Cron Alert   : Lab kit tx is 26h overdue, cron will flag it');
  console.log('='.repeat(60) + '\n');

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((e) => {
  console.error('[seed] fatal error:', e);
  process.exit(1);
});

