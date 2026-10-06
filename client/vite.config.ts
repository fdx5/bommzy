import { defineConfig } from 'vite';

export default defineConfig({
  // /api → local BOOMZY server (npm run dev:server)
  server: { port: 5173, host: true, proxy: { '/api': 'http://localhost:8787' } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
});
