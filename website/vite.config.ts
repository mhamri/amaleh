import { defineConfig } from 'vite';
import { solidStart } from '@solidjs/start/config';
import tailwindcss from '@tailwindcss/vite';
import { nitro } from 'nitro/vite';
import './src/lib/pool.ts';

const base = process.env.SITE_BASE || '/';
if (!base.startsWith('/') || !base.endsWith('/') || base.includes('..')) {
  throw new Error('SITE_BASE must be an absolute URL path with leading and trailing slashes.');
}
export default defineConfig({
  base,
  plugins: [tailwindcss(), solidStart({ ssr: true, devOverlay: false }), nitro()],
  nitro: {
    preset: 'static',
    baseURL: base,
    prerender: { crawlLinks: true, failOnError: true, routes: ['/evidence/'] },
  },
});
