import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Auth store — JWT + user, persisted to localStorage. */
export const useAuth = create(
  persist(
    (set) => ({
      user: null,
      token: null,
      setAuth: ({ user, token }) => set({ user, token }),
      setUser: (user) => set({ user }),
      logout: () => set({ user: null, token: null }),
    }),
    { name: 'cx-auth' }
  )
);
