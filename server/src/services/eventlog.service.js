import DbEvent from '../models/DbEvent.js';

/**
 * DB event log — every notable database-technology touchpoint is recorded here.
 * Powers the admin "DB Technology Monitor" (step 12) and demonstrates each
 * paradigm firing in real time (great for the viva demo).
 */
export async function logDbEvent(paradigm, type, message, payload = {}) {
  try {
    const ev = await DbEvent.create({ paradigm, type, message, payload });
    // Push to live admin monitor over Socket.io (see sockets/index.js)
    const { emitDbEvent } = await import('../sockets/index.js');
    if (emitDbEvent) emitDbEvent(ev);
    return ev;
  } catch (err) {
    console.error('[eventlog] failed:', err.message);
    return null;
  }
}
