import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy: /api + /uploads hit the Express server (port 8044); /socket.io
// proxies the websocket for live notifications (Active DB layer).
// Client dev server runs on port 6390 (host: true binds IPv4+IPv6;
// strictPort: true fails loudly instead of drifting to another port).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 6390,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:8044', changeOrigin: true },
      '/uploads': { target: 'http://localhost:8044', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:8044', changeOrigin: true, ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 1600 },
});
