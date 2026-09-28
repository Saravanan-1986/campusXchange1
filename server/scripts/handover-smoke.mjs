/**
 * End-to-end SMOKE TEST for the handover flow introduced with the graph +
 * custody feature set. Exercises the real HTTP API (server must be running):
 *
 *   npm run dev --prefix server      # in one terminal
 *   node scripts/handover-smoke.mjs  # in another
 *
 * Covers: listing → chat → /donate command → marketplace removal → Items
 * received → re-list (sell) → unlist → PostgreSQL custody chain → MongoDB
 * timeline → Neo4j graph endpoints (tagged when the graph is offline).
 */
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import User from '../src/models/User.js';

const API = `http://localhost:${env.port}/api`;
let pass = 0;
let fail = 0;

function check(label, ok, extra = '') {
  if (ok) { pass += 1; console.log(`  OK   ${label}`); }
  else { fail += 1; console.error(`  FAIL ${label} ${extra}`); }
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

const has = (list, id) => (list || []).some((r) => String(r._id) === String(id));

async function main() {
  await mongoose.connect(env.mongoUri);
  const [giver, receiver] = await Promise.all([
    User.findOne({ collegeEmail: 'shinsu@ceg.edu' }),
    User.findOne({ collegeEmail: 'hattori@ceg.edu' }),
  ]);
  if (!giver || !receiver) throw new Error('Seed users shinsu@ceg.edu / hattori@ceg.edu not found');
  const tokenOf = (u) => jwt.sign({ id: u._id, role: u.role }, env.jwtSecret, { expiresIn: '1h' });
  const giverToken = tokenOf(giver);
  const receiverToken = tokenOf(receiver);
  console.log(`[smoke] giver=${giver.name} receiver=${receiver.name} api=${API}`);

  // 1) Giver lists an item --------------------------------------------------
  const created = await call('POST', '/resources', {
    token: giverToken,
    body: {
      title: 'DBMS Textbook (handover demo)', category: 'textbook', subject: 'DBMS',
      department: 'Computer Science', semester: 5, condition: 'good', listingType: 'donate', price: 0,
      description: 'Smoke-test item that walks through donate → re-list → unlist.',
    },
  });
  check('create listing', created.status === 201, JSON.stringify(created.data).slice(0, 160));
  const rid = created.data?.resource?._id;
  if (!rid) throw new Error('Listing was not created');

  const before = await call('GET', '/resources');
  check('listing appears on the marketplace', has(before.data?.resources, rid));

  // 2) Receiver opens a chat about it --------------------------------------
  const chat = await call('POST', '/messages/quick', { token: receiverToken, body: { resourceId: rid } });
  check('chat thread opened', chat.status === 201 && !!chat.data?.conversationId);
  const cid = chat.data?.conversationId;

  // 3) A non-owner may not run the handover command -------------------------
  const forbidden = await call('POST', `/messages/conversations/${cid}/command`, {
    token: receiverToken, body: { command: 'donate' },
  });
  check('receiver is blocked from /donate', forbidden.status === 403, `got ${forbidden.status}`);

  // 4) Owner types /donate in the chat window ------------------------------
  const command = await call('POST', `/messages/conversations/${cid}`, { token: giverToken, body: { body: '/donate' } });
  check('/donate command processed', command.status === 201 && command.data?.command === 'donate',
    JSON.stringify(command.data).slice(0, 200));

  const after = await call('GET', '/resources');
  check('item left the marketplace', !has(after.data?.resources, rid));

  const received = await call('GET', '/resources/received', { token: receiverToken });
  check('receiver sees it in Items received', has(received.data?.resources, rid));
  check('receiver transferCount = 1',
    Number((received.data?.resources || []).find((r) => String(r._id) === String(rid))?.transferCount) === 1);

  const giverMine = await call('GET', '/resources/mine', { token: giverToken });
  check('giver no longer owns it', !has(giverMine.data?.resources, rid));


  // 5) TEMPORAL: PostgreSQL custody chain ----------------------------------
  const custody = await call('GET', `/temporal/resources/${rid}/custody`);
  const chain = custody.data?.chain || [];
  check('custody chain has 2 custodians', chain.length === 2, `got ${chain.length}`);
  check('chain records the giver then the receiver',
    chain[0]?.owner_id === String(giver._id) && chain[1]?.owner_id === String(receiver._id));
  check('no overlapping custody periods', Number(custody.data?.integrity?.overlap_count || 0) === 0);
  check('handover kind recorded as donated', chain[1]?.kind === 'donated', `got ${chain[1]?.kind}`);

  const history = await call('GET', `/resources/${rid}/history`);
  check('MongoDB timeline has the handover version',
    (history.data?.history || []).some((h) => String(h.change?.summary || '').includes('Donated')));

  const handovers = await call('GET', '/temporal/handovers', { token: receiverToken });
  check('recent handovers feed includes the item',
    (handovers.data?.handovers || []).some((h) => String(h.resource_id) === String(rid)));

  // 6) RE-LIST what you received (sell it on) ------------------------------
  const relist = await call('POST', `/resources/${rid}/relist`, {
    token: receiverToken, body: { listingType: 'sell', price: 150 },
  });
  check('receiver re-listed it for sale',
    relist.data?.resource?.listingType === 'sell' && relist.data?.resource?.price === 150,
    JSON.stringify(relist.data).slice(0, 140));

  const relisted = await call('GET', '/resources');
  const onMarket = (relisted.data?.resources || []).find((r) => String(r._id) === String(rid));
  check('item is back on the marketplace with the new owner',
    !!onMarket && String(onMarket.ownerId?._id || onMarket.ownerId) === String(receiver._id));

  // 7) Unlist WITHOUT giving it to anyone ----------------------------------
  const unlisted = await call('POST', `/resources/${rid}/unlist`, { token: receiverToken, body: {} });
  check('unlist succeeds', unlisted.status === 200 && unlisted.data?.ok === true);
  const finalList = await call('GET', '/resources');
  check('unlisted item is hidden from the marketplace', !has(finalList.data?.resources, rid));

  const mineNow = await call('GET', '/resources/mine', { token: receiverToken });
  const mineItem = (mineNow.data?.resources || []).find((r) => String(r._id) === String(rid));
  check('owner still has it in My items (unlisted)', !!mineItem && mineItem.isListed === false);

  // 8) GRAPH endpoints (Neo4j, or the tagged Mongo fallback) ---------------
  const related = await call('GET', `/graph/resources/${rid}/related`);
  check('related items answered', Array.isArray(related.data?.data) && !!related.data?.source,
    JSON.stringify(related.data).slice(0, 120));
  const status = await call('GET', '/graph/status');
  check('graph status answers', !!status.data?.status, JSON.stringify(status.data).slice(0, 120));
  const chainRes = await call('GET', `/graph/resources/${rid}/chain`);
  check('graph handover chain answers', !!chainRes.data?.source);

  // 9) Leave the demo tidy: it stays listed for the next handover ----------
  await call('POST', `/resources/${rid}/relist`, { token: receiverToken, body: { listingType: 'donate', price: 0 } });
  console.log(`[smoke] demo item ${rid} — inspect its History timeline + Related graph tabs`);

  console.log(`\n[smoke] ${pass} passed · ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('[smoke] fatal:', err.message);
  process.exit(1);
});

