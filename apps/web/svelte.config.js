import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // The restaurant site at / is plain static HTML in `static/` (index.html,
    // menu.html, ...), so SvelteKit only owns the two product pages. Prerender
    // those explicitly: crawling would follow their link to `/` and 404,
    // because a static file is not a route.
    prerender: { entries: ['/pos', '/film'], crawl: false },
    // Fully prerendered static site — deployable to Cloudflare Pages / Workers static assets.
    adapter: adapter({ pages: 'build', assets: 'build', fallback: undefined, strict: true })
  }
};

export default config;
