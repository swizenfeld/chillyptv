import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.CHILLY_BACKEND ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: backend, changeOrigin: true } },
  },
  build: {
    outDir: 'dist',
    // Fire TV sticks run older Android WebViews (Fire OS 7/8): compile down to Chrome 87-level JS.
    target: ['es2020', 'chrome87'],
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
} as any);
