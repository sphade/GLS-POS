import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Fully prerendered static site — deployable to Cloudflare Pages / Workers static assets.
    adapter: adapter({ pages: 'build', assets: 'build', fallback: undefined, strict: true })
  }
};

export default config;
