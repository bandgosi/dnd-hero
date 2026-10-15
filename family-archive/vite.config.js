import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const API_PORT = Number(process.env.PORT) || 3000;

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    fs: { allow: [path.resolve(import.meta.dirname)] },
    proxy: {
      '/api': `http://127.0.0.1:${API_PORT}`,
      '/media': `http://127.0.0.1:${API_PORT}`,
    },
  },
});
