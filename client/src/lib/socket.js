import { io } from 'socket.io-client';
import { useAuth } from '../store/auth.js';
import { useUI } from '../store/ui.js';
import { queryClient } from '../api/queryClient.js';

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

  // CHAT: a new bubble arrived in one of my threads → badge + thread list refresh.
  socket.on('message:new', (m) => {
    useUI.getState().bumpChatUnread(1);
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
    if (window.location.pathname !== '/chat') {
      useUI.getState().pushToast({
        title: `💬 ${m.peerName || 'New message'}`,
        message: m.resourceTitle ? `${m.resourceTitle}: ${m.body}` : m.body,
        variant: 'info',
        link: `/chat?c=${m.conversationId}`,
      });
    }
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
