import { defineConfig, type Plugin } from 'vite';
import { solidStart } from '@solidjs/start/config';
import tailwindcss from '@tailwindcss/vite';
import { nitro } from 'nitro/vite';
import { layoutHero } from './src/lib/hero-layout.ts';
import { DECISION, DECISION_FAMILY, REPAIR, REPAIR_FAMILY, WORKERS, WORKER_FAMILIES } from './src/lib/pool.ts';

const base = process.env.SITE_BASE || '/';
if (!base.startsWith('/') || !base.endsWith('/') || base.includes('..')) {
  throw new Error('SITE_BASE must be an absolute URL path with leading and trailing slashes.');
}

const HERO_ID = 'virtual:hero-scene';
const HERO_FILE = `\0${HERO_ID}`;

function heroScene(): Plugin {
  let pending: Promise<string> | null = null;
  return {
    name: 'hero-scene',
    resolveId: (id) => (id === HERO_ID ? HERO_FILE : null),
    load(id) {
      if (id !== HERO_FILE) return null;
      pending ??= (async () => {
        const pool = {
          workers: WORKERS.map((worker, index) => ({ family: WORKER_FAMILIES[index] as string, name: worker.name })),
          deep: { family: REPAIR_FAMILY, name: REPAIR.name },
          decision: { family: DECISION_FAMILY, name: DECISION.name },
        };
        const wide = await layoutHero(pool, 'wide');
        const narrow = await layoutHero(pool, 'narrow');
        return `export default ${JSON.stringify({ wide, narrow })};\n`;
      })();
      return pending;
    },
  };
}

export default defineConfig({
  base,
  plugins: [tailwindcss(), heroScene(), solidStart({ ssr: true, devOverlay: false }), nitro()],
  nitro: {
    preset: 'static',
    baseURL: base,
    prerender: { crawlLinks: true, failOnError: true, routes: ['/evidence/'] },
  },
});
