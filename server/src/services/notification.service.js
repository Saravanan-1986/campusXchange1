import Notification from '../models/Notification.js';
import { emitToUser } from '../sockets/index.js';
import { logDbEvent } from './eventlog.service.js';

/** Persist a notification and push it live over Socket.io. */
export async function notify({ user, type, title, message = '', link = '', paradigm = null, extra = {} }) {
  const n = await Notification.create({ user, type, title, message, link, meta: { paradigm, extra } });
  emitToUser(String(user), 'notification', n);
  await logDbEvent(paradigm || 'mongodb', 'notification.created', title, {
    user: String(user),
    type,
  });
  return n;
}
