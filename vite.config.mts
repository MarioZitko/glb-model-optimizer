import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Strict CSP for the packaged app only (the dev server needs inline scripts and websockets).
// 'wasm-unsafe-eval' is required by the Meshopt decoder used to preview compressed output.
const csp: Plugin = {
  name: 'csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content:
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' blob: data:",
      },
      injectTo: 'head-prepend',
    },
  ],
};

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), csp],
  server: { port: 5199, strictPort: false },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
