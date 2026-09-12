import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

let io = null;
const onlineUsers = new Map(); // userId -> Set(socketId)

export function initSockets(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.clientUrl, credentials: true },
  });

  // Auth handshake: client passes its JWT
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('unauthorized'));
      const decoded = jwt.verify(token, env.jwtSecret);
      socket.data.userId = decoded.id;
      socket.data.role = decoded.role;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const uid = socket.data.userId;
    if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
    onlineUsers.get(uid).add(socket.id);
    socket.join(`user:${uid}`);
    if (socket.data.role === 'admin') socket.join('admin');

    socket.on('disconnect', () => {
      const set = onlineUsers.get(uid);
      if (set) {
        set.delete(socket.id);
        if (!set.size) onlineUsers.delete(uid);
      }
    });
  });

  console.log('[sockets] Socket.io ready');
  return io;
}

/** Emit a realtime event to every socket of one user (live toasts, badge). */
export function emitToUser(userId, event, payload) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

/** Push a DB-technology event into the admin live monitor feed. */
export function emitDbEvent(dbEvent) {
  if (!io) return;
  io.to('admin').emit('db:event', dbEvent);
}

export function isOnline(userId) {
  return onlineUsers.has(String(userId));
}
