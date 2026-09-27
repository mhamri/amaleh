import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startSite, fail, finish } from './browser-harness.mjs';

const checksDir = join(dirname(fileURLToPath(import.meta.url)), 'wins-checks');

const site = await startSite();

try {
  const modules = (await readdir(checksDir)).filter((name) => name.endsWith('.mjs')).sort();
  if (modules.length === 0) fail(`no win check module found in ${checksDir}`);
  for (const name of modules) {
    const module = await import(pathToFileURL(join(checksDir, name)).href);
    if (typeof module.run !== 'function') {
      fail(`${name} does not export a run(site) function`);
      continue;
    }
    await module.run(site);
  }
} catch (error) {
  fail(`Wins check could not run: ${error.stack ?? error.message}`);
} finally {
  await site.close().catch(() => {});
}

finish('Wins check');