import { defineConfig } from 'astro/config';

// Published by .github/workflows/pages.yml at https://ajamit17.github.io/luther/
export default defineConfig({
  site: 'https://ajamit17.github.io',
  base: '/luther',
  build: { inlineStylesheets: 'never' },
});
