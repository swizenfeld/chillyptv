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
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
} as any);
