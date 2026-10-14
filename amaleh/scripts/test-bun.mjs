import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testTimeLimitMs } from '../tests/time-limit.ts';

const skillDir = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const namesTestPath = args.some((arg) => !arg.startsWith('-') && existsSync(resolve(skillDir, arg)));

const child = spawn(process.execPath, ['test', '--timeout', String(testTimeLimitMs), ...(namesTestPath ? [] : ['tests/']), ...args], {
  cwd: skillDir,
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
});
child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
child.on('close', (code) => process.exit(code ?? 1));
