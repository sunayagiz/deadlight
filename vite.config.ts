import { defineConfig } from 'vite';

// Relative base so the built game runs from ANY path — repo-root hosting
// (Cloudflare Pages) or a project subpath (GitHub Pages /deadlight/) alike.
// Runtime asset URLs use import.meta.env.BASE_URL, which follows this.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500, // Phaser is a big single dependency; don't warn
  },
});
