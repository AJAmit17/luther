import { defineConfig } from 'astro/config';

// Published on Cloudflare Pages at https://getluther.pages.dev (root: site, build: npm run build, output: dist)
export default defineConfig({
  site: 'https://getluther.pages.dev',
  build: { inlineStylesheets: 'never' },
});
