import { io } from 'socket.io-client';
import { useAuth } from '../store/auth.js';
import { useUI } from '../store/ui.js';
import { queryClient } from '../main.jsx';

/**
 * Socket.io singleton — realtime channel of the ACTIVE DB layer:
 *  - 'notification' → live glass toast + unread badge
 *  - 'db:event'     → admin DB Technology Monitor live feed
 */
let socket = null;

export function connectSocket() {
  const token = useAuth.getState().token;
  if (!token || socket?.connected) return socket;
  if (socket) socket.disconnect();
  socket = io('/', { auth: { token }, transports: ['websocket', 'polling'] });

  socket.on('notification', (n) => {
    useUI.getState().setUnread(useUI.getState().unread + 1);
    useUI.getState().pushToast({
      title: n.title,
      message: n.message,
      variant: n.type === 'overdue' || n.type === 'report' ? 'warning' : 'info',
      link: n.link,
    });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  });

  socket.on('db:event', (ev) => {
    useUI.getState().pushDbEvent(ev);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
