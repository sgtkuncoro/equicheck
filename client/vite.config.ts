import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Under `turbo run dev` this process does not own the terminal. Vite's default
  // screen clear would wipe the server task's startup output, including the
  // GEMINI_API_KEY warning a reviewer with no key needs to see.
  clearScreen: false,
  server: {
    port: 5173,
    proxy: {
      // Same-origin in dev, so the app needs no CORS handling anywhere. In
      // production Express serves this build and /api from one port.
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
