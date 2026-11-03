import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000', '/uploads': 'http://localhost:4000' },
  },
  // `npm run build:demo` makes a self-contained demo with a simulated backend
  build: mode === 'demo'
    ? { outDir: 'dist-demo', assetsInlineLimit: 1e8, cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } } }
    : {},
}));
