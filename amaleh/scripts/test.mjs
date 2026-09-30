import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

const skillDir = fileURLToPath(new URL('../', import.meta.url));
const testDir = new URL('../tests/', import.meta.url);

const files = (await readdir(testDir))
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => `tests/${name}`);

if (files.length === 0) {
  console.error('No test files found under amaleh/tests.');
  process.exit(1);
}

const code = await new Promise((done, fail) => {
  const child = spawn(process.execPath, ['--test', `--test-concurrency=${Math.max(1, Math.floor(availableParallelism() / 2))}`, ...files], {
    cwd: skillDir,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });
  child.on('error', fail);
  child.on('close', done);
});

process.exit(code ?? 1);
