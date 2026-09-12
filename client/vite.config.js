import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy: /api + /uploads hit the Express server; /socket.io proxies the
// websocket for live notifications (Active DB layer).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5001', changeOrigin: true },
      '/uploads': { target: 'http://localhost:5001', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:5001', changeOrigin: true, ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 1600 },
});
