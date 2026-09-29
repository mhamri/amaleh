import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as c from '../scripts/core.ts';
import { humanRequested, renderHuman, renderResult, stripFlags } from '../scripts/render.ts';

const cli = fileURLToPath(new URL('../scripts/cli.ts', import.meta.url));

const samples: Record<string, unknown> = {
  doctor: {
    runtime: { engine: 'node', version: '24.0.0', nodeCompatibility: '24.0.0', executable: '/usr/bin/node' },
    platform: 'linux', pi: { command: 'node', args: ['/pi/cli.js'] },
    openrouterConfigured: true, dependencies: 'No npm runtime dependencies',
    jevEndpoint: 'https://openrouter.ai/api/alpha/decisions',
  },
  list: [
    { id: 'second', status: 'active', intent: 'Correct charge amount', criteria: ['Correct amount charged'], tasks: 2, revision: 4, continues: 'first' },
    { id: 'first', status: 'complete', intent: 'Build the checkout', criteria: ['Checkout works'], tasks: 3, revision: 9, acceptance: { fingerprint: 'abc', claims: ['checked'] } },
  ],
  status: {
    run: 'charge', host: { kind: 'codex', model: 'gpt-6-astra' }, intent: 'Correct charge amount',
    criteria: ['Correct amount charged'], constraints: ['No new dependency'],
    artifactDirectory: '/runs/charge/artifacts', decisions: [{ id: 'palette', choice: 'night' }],
    phaseStatus: [{ id: 'charge', phase: 'checkout', status: 'review', deps: [], integrated: false }],
    next: { action: 'check', task: 'charge' },
  },
  health: {
    available: true,
    metrics: {
      tasks: 2, coordinatorDecisions: 1, coordinatorDecisionsPerTask: 0.5, workerJevCalls: 3,
      delegations: 2, workerDispatches: 2, hostTakeovers: 3, hostTakeoversByTask: { seo: 3 }, hostActionRecords: 3, hostActionsPerTask: 1.5,
      revisions: 604, coordinatorOperations: 9, coordinatorOperationsPerTask: 4.5, contractQuestions: 1, unstableChecks: 2, retries: 1, workerFamilies: { deepseek: 1, zai: 1 },
    },
    warnings: [],
  },
  next: { action: 'route-dispatch', tasks: [{ id: 'charge', goal: 'Correct charge' }], available: 2 },
  diagnose: {
    state: {
      run: 'charge', intent: 'Correct charge amount', host: { kind: 'codex', model: 'gpt-6-astra' },
      phaseStatus: [{ id: 'charge', phase: 'checkout', status: 'review' }], next: { action: 'check' },
    },
    stateError: undefined,
    hostActions: { records: [{ actionId: 'a1' }], unreadable: [] },
    diagnostics: { operations: [{ id: 'o1', outcome: 'success' }], totals: { operations: 3, unfinished: 0, failures: 1, reportedCost: 0.02, estimatedCost: 0.03, inputTokens: 900, outputTokens: 300 }, unreadable: [] },
    health: { available: true, warnings: [], metrics: { spend: { total: { key: 'total', estimatedCost: 0.012, costSource: 'openrouter-catalog', piEstimate: 0.03 } } } },
  },
  preflight: {
    checkedAt: '2026-01-01T00:00:00.000Z', channel: 'synthetic-test', network: 'allowed',
    permissionSource: 'host-declared', synthetic: true, projectExportAuthorized: false,
    action: 'ready', ready: true, model: 'synthetic/jev', confidence: 1, elapsedMs: 42,
    artifact: 'artifact-hash',
  },
};

// The value column is where the label padding plus the two-space separator ends.
function valueColumns(report: string): number[] {
  return report.split('\n')
    .filter((line) => / {2,}/.test(line) && !line.startsWith('- '))
    .map((line) => {
      const separator = line.match(/ {2,}/)!;
      return separator.index! + separator[0].length;
    });
}

test('a person at a terminal gets a headline and aligned rows for every listed operation', () => {
  for (const [operation, value] of Object.entries(samples)) {
    const report = renderHuman(operation, value);
    assert.notEqual(report, JSON.stringify(value, null, 2), `${operation} fell back to raw JSON`);
    const [headline] = report.split('\n');
    assert.ok(headline.length > 0 && !headline.startsWith(' '), `${operation} needs a headline`);
    const columns = valueColumns(report);
    assert.ok(columns.length > 0, `${operation} needs detail rows`);
    assert.equal(new Set(columns).size, 1, `${operation} rows are not aligned: ${JSON.stringify(columns)}`);
  }
});

test('health names how often the host took a task over, per task', () => {
  assert.match(renderHuman('health', samples.health), /Host takeovers +3 \(seo:3\)/);
});

test('health counts the coordinator\'s own operations and shows state revisions without an allowance', () => {
  const report = renderHuman('health', samples.health);
  assert.match(report, /Coordinator operations +9 \(4\.5 per task\)/);
  assert.match(report, /Contract questions +1/);
  assert.match(report, /Checks failing only under load +2/);
  assert.match(report, /State revisions +604$/m);
  assert.doesNotMatch(report, /allowed/);
});

test('spend names where each price came from, beside the pi estimate', () => {
  const health = samples.health as { metrics: Record<string, unknown> };
  const spend = { byModel: [{ key: 'moonshotai/kimi-k3', estimatedCost: 0.193, costSource: 'openrouter-catalog', piEstimate: 0.138, calls: 1, turns: 8, inputTokens: 34723, cacheReadTokens: 92160, outputTokens: 4050 }] };
  const report = renderHuman('health', { ...health, metrics: { ...health.metrics, spend } });
  assert.match(report, /Name +Est\. \$ +Priced from +pi est\. \$/);
  assert.match(report, /moonshotai\/kimi-k3 +0\.193 +openrouter-catalog +0\.138/);
  assert.match(renderHuman('diagnose', samples.diagnose), /Cost +\$0\.020 reported, \$0\.012 estimated from openrouter-catalog \(pi estimated \$0\.030\)/);
  const unpriced = { ...(samples.diagnose as object), health: { available: false, reason: 'state unreadable' } };
  assert.match(renderHuman('diagnose', unpriced), /Cost +\$0\.020 reported, \$0\.030 estimated by pi/);
  const diagnostics = (samples.diagnose as { diagnostics: { totals: object } }).diagnostics;
  const tiny = { ...(samples.diagnose as object), diagnostics: { ...diagnostics, totals: { ...diagnostics.totals, reportedCost: 0.000201096 } } };
  assert.match(renderHuman('diagnose', tiny), /Cost +\$0\.00020 reported/);
});

test('an operation without a renderer pretty-prints the same JSON detail', () => {
  const value = { score: 1, checks: ['a', 'b'] };
  assert.equal(renderHuman('bench', value), JSON.stringify(value, null, 2));
});

test('the readable report is opt-in by terminal, and --json forces the machine record', () => {
  assert.equal(humanRequested([], true), true, 'a terminal without the flag is human');
  assert.equal(humanRequested([], false), false, 'a pipe without the flag is JSON');
  assert.equal(humanRequested([], undefined), false, 'an unknown terminal is JSON');
  assert.equal(humanRequested(['doctor', '--json'], true), false, '--json wins over a terminal');
  assert.deepEqual(stripFlags(['status', 'ws', 'run', '--json']), ['status', 'ws', 'run'], '--json is not a path');
  assert.equal(renderResult('doctor', samples.doctor, false), JSON.stringify(samples.doctor, null, 2), 'JSON is byte-identical');
  assert.equal(renderResult('doctor', samples.doctor, true), renderHuman('doctor', samples.doctor), 'human mode renders');
});

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', fail);
    child.on('close', (code) => done({ code: code ?? 1, stdout, stderr }));
  });
}

test('a real run prints byte-identical JSON off a terminal and with --json', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'amaleh-render-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await c.start(dir, { id: 'run', host: { kind: 'codex', model: 'gpt-6-astra' }, intent: 'Correct charge amount', criteria: ['Correct amount charged'] });
  const plain = await runCli(['list', dir]);
  const forced = await runCli(['list', dir, '--json']);
  assert.equal(plain.code, 0, plain.stderr);
  assert.equal(forced.code, 0, forced.stderr);
  assert.equal(plain.stdout, forced.stdout, 'a pipe and --json must print the same bytes');
  const parsed = JSON.parse(plain.stdout);
  assert.ok(Array.isArray(parsed) && parsed[0].id === 'run');
  assert.equal(plain.stdout, `${JSON.stringify(parsed, null, 2)}\n`, 'the machine record is unchanged');
});
