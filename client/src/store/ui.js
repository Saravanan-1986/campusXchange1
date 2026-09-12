import { create } from 'zustand';

let toastId = 0;

/** UI store — glass toasts, unread badge, live DB-event feed (admin), sidebar. */
export const useUI = create((set, get) => ({
  toasts: [],
  unread: 0,
  dbEvents: [],
  sidebarOpen: true,
  pushToast: (toast) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, ...toast }] }));
    setTimeout(() => get().removeToast(id), toast.duration || 5200);
    return id;
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setUnread: (n) => set({ unread: n }),
  pushDbEvent: (ev) => set((s) => ({ dbEvents: [ev, ...s.dbEvents].slice(0, 80) })),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
