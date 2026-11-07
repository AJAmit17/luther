import { defineConfig } from 'astro/config';

// Published on Cloudflare Pages at https://luther.pages.dev (root: site, build: npm run build, output: dist)
export default defineConfig({
  site: 'https://luther.pages.dev',
  build: { inlineStylesheets: 'never' },
});
