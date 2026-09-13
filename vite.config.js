import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true
  },

  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true
  },

  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 4096,
    cssCodeSplit: true
  }
});
