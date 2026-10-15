import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { uiSourceHash } from './scripts/lib/ui-hash.mjs';

const API_PORT = Number(process.env.PORT) || 3000;

export default defineConfig({
  root: 'client',
  plugins: [
    react(),
    {
      // Отпечаток исходников — чтобы на сервере не пересобирать интерфейс без необходимости.
      name: 'build-info',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify({ format: 1, sourceHash: uiSourceHash(import.meta.dirname) }, null, 2) + '\n' });
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    fs: { allow: [path.resolve(import.meta.dirname)] },
    proxy: {
      // Host остаётся как в браузере (localhost:5173): сервер сверяет его с Origin.
      '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false },
      '/media': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false },
    },
  },
});
