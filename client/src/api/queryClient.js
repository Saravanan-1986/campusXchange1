import { QueryClient } from '@tanstack/react-query';

/** React Query client — lives in its own module to avoid the
 *  main.jsx ↔ lib/socket.js circular import. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 20_000 },
  },
});
