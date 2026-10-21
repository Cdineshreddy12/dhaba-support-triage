import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    // Proxied so there is no CORS configuration to get wrong in dev.
    proxy: {
      '/triage': 'http://localhost:3000',
      '/readyz': 'http://localhost:3000',
      '/tickets': 'http://localhost:3000',
    },
  },
});
