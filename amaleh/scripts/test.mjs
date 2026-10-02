import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
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

const spawnsGit = async (file) => /['"]git['"]/.test(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
const gitFiles = [];
const otherFiles = [];
for (const file of files) ((await spawnsGit(file)) ? gitFiles : otherFiles).push(file);

const run = (concurrency, batch) =>
  batch.length === 0
    ? 0
    : new Promise((done, fail) => {
        const child = spawn(process.execPath, ['--test', `--test-concurrency=${concurrency}`, ...batch], {
          cwd: skillDir,
          stdio: 'inherit',
          shell: false,
          windowsHide: true,
        });
        child.on('error', fail);
        child.on('close', (code) => done(code ?? 1));
      });

// See references/verification.md#the-node-test-runner
const parallelCode = await run(Math.max(1, Math.floor(availableParallelism() / 2)), otherFiles);
const serialCode = await run(1, gitFiles);

process.exit(parallelCode || serialCode);
