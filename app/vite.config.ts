import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// base './' so the build works from any sub-path (e.g. GitHub Pages /repo/)
export default defineConfig({
  base: './',
  plugins: [preact()],
  server: { host: true, watch: { ignored: ['**/localtest/**', '**/.local/**'] } },
});
