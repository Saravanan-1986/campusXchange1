import mongoose from 'mongoose';
import { env } from './env.js';

/** MongoDB (NoSQL document store) — primary data store of CampusXchange. */
export async function connectDatabase() {
  mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(env.mongoUri);
    console.log(`[db] MongoDB connected → ${mongoose.connection.name}`);
    return mongoose.connection;
  } catch (err) {
    console.error('[db] MongoDB connection failed:', err.message);
    // Keep process alive: mongoose retries, HTTP API can still boot.
    return null;
  }
}

export function mongoStatus() {
  const s = mongoose.connection.readyState; // 0=disconnected 1=connected 2=connecting 3=disconnecting
  return s === 1 ? 'connected' : s === 2 ? 'connecting' : 'disconnected';
}
