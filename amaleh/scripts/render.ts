// Human-readable printing for the operations a person runs.
//
// This module only formats the value an operation already returned. It never
// reads state, never adds fields and never changes what a caller receives:
// machine output stays JSON.stringify(value, null, 2) exactly as before.

type Row = readonly [label: string, value: string];

const none = '—';

function text(value: unknown): string {
  if (value === undefined || value === null || value === '') return none;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.length ? value.map(text).join(', ') : none;
  return JSON.stringify(value);
}

function dollars(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return text(value);
  return `$${value > 0 && value < 0.001 ? value.toPrecision(2) : value.toFixed(3)}`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function humanLabel(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (character) => character.toUpperCase());
}

// Aligned detail rows: every value starts at the same column.
function rows(pairs: Row[]): string {
  const visible = pairs.filter(([, value]) => value !== none && value !== '');
  const width = visible.reduce((max, [label]) => Math.max(max, label.length), 0);
  return visible.map(([label, value]) => `${label.padEnd(width)}  ${value}`).join('\n');
}

// Compact detail for a value the report lists rather than dumps: arrays of
// records are named by their id (and goal), everything else by its text.
function summarize(value: unknown): string {
  if (!Array.isArray(value)) return text(value);
  if (!value.length) return none;
  return value.map((item) => {
    const entry = record(item);
    if (typeof entry.id === 'string') return entry.goal === undefined ? entry.id : `${entry.id}: ${text(entry.goal)}`;
    return text(item);
  }).join(', ');
}

function report(headline: string, pairs: Row[]): string {
  const detail = rows(pairs);
  return detail ? `${headline}\n\n${detail}` : headline;
}

function idList(value: unknown, field: string): string {
  if (!Array.isArray(value)) return none;
  const ids = value.map(record).map((entry) => text(entry[field])).filter((id) => id !== none);
  return ids.length ? ids.join(', ') : none;
}

function renderDoctor(value: unknown): string {
  const v = record(value), runtime = record(v.runtime), pi = record(v.pi);
  const auth = v.openrouterConfigured === true;
  const command = [pi.command, ...(Array.isArray(pi.args) ? pi.args.map(text) : [])].filter((part) => part && part !== none).join(' ');
  return report(`Amaleh doctor — ${auth ? 'ready' : 'OpenRouter credentials missing'}`, [
    ['Runtime', `${text(runtime.engine)} ${text(runtime.version)}`],
    ['Node', text(runtime.nodeCompatibility)],
    ['Executable', text(runtime.executable)],
    ['Platform', text(v.platform)],
    ['pi', command],
    ['OpenRouter credentials', auth ? 'configured' : 'missing'],
    ['Dependencies', text(v.dependencies)],
    ['Jev endpoint', text(v.jevEndpoint)],
  ]);
}

function renderList(value: unknown): string {
  const runs = Array.isArray(value) ? value.map(record) : [];
  const headline = `Amaleh runs — ${runs.length} recorded, newest revision first`;
  if (!runs.length) return `${headline}\n\nNo runs recorded in this workspace.`;
  return report(headline, runs.map((run) => {
    const detail = [
      text(run.status),
      `revision ${text(run.revision)}`,
      `${text(run.tasks)} task(s)`,
      run.continues ? `continues ${text(run.continues)}` : '',
      text(run.intent),
    ].filter(Boolean).join(' · ');
    return [text(run.id), detail] as Row;
  }));
}

function renderStatus(value: unknown): string {
  const v = record(value), host = record(v.host), next = record(v.next);
  const phases = Array.isArray(v.phaseStatus) ? v.phaseStatus.map(record) : [];
  const criteria = Array.isArray(v.criteria) ? v.criteria.length : 0;
  const constraints = Array.isArray(v.constraints) ? v.constraints.length : 0;
  const decisions = Array.isArray(v.decisions) ? v.decisions.length : 0;
  return report(`Run ${text(v.run)} — next: ${text(next.action)}`, [
    ['Host', `${text(host.kind)} / ${text(host.model)}`],
    ['Intent', text(v.intent)],
    ['Criteria', `${criteria} acceptance ${criteria === 1 ? 'criterion' : 'criteria'}`],
    ['Constraints', constraints ? `${constraints} recorded` : 'none'],
    ['Tasks', phases.length ? phases.map((phase) => `${text(phase.id)}:${text(phase.status)}`).join(', ') : 'none planned'],
    ['Decisions', `${decisions} settled`],
    ['Artifacts', text(v.artifactDirectory)],
  ]);
}

function renderHealth(value: unknown): string {
  const v = record(value);
  if (v.available !== true) return report('Delegation health — unavailable', [['Reason', text(v.reason)]]);
  const metrics = record(v.metrics), warnings = Array.isArray(v.warnings) ? v.warnings.map(text) : [];
  const families = Object.entries(record(metrics.workerFamilies)).map(([family, count]) => `${family}:${text(count)}`);
  const takeovers = Object.entries(record(metrics.hostTakeoversByTask)).map(([task, count]) => `${task}:${text(count)}`);
  const body = report(`Delegation health — ${warnings.length ? `${warnings.length} warning(s)` : 'no warnings'}`, [
    ['Tasks', text(metrics.tasks)],
    ['Coordinator decisions', `${text(metrics.coordinatorDecisions)} (${text(metrics.coordinatorDecisionsPerTask)} per task)`],
    ['Worker Jev calls', text(metrics.workerJevCalls)],
    ['Delegations', text(metrics.delegations)],
    ['Worker dispatches', text(metrics.workerDispatches)],
    ['Host takeovers', takeovers.length ? `${text(metrics.hostTakeovers)} (${takeovers.join(', ')})` : text(metrics.hostTakeovers)],
    ['Host action records', `${text(metrics.hostActionRecords)} (${text(metrics.hostActionsPerTask)} per task)`],
    ['Coordinator operations', `${text(metrics.coordinatorOperations)} (${text(metrics.coordinatorOperationsPerTask)} per task)`],
    ['Contract questions', text(metrics.contractQuestions)],
    ['Checks failing only under load', text(metrics.unstableChecks)],
    ['State revisions', text(metrics.revisions)],
    ['Retries', text(metrics.retries)],
    ['Worker families', families.join(', ')],
  ]);
  const spend = record(metrics.spend);
  const sections = [body, speedTable(metrics.modelSpeed), spendTable('Estimated spend by model', spend.byModel), spendTable('Estimated spend by role', spend.byRole), spendTable('Estimated spend by task', spend.byTask)];
  if (warnings.length) sections.push(`Warnings\n${warnings.map((warning) => `- ${warning}`).join('\n')}`);
  sections.push(slowSection(v.slowModels));
  return sections.filter(Boolean).join('\n\n');
}

function table(title: string, header: string[], body: string[][]): string {
  if (!body.length) return '';
  const widths = header.map((_, column) => Math.max(header[column].length, ...body.map((row) => row[column].length)));
  const line = (cells: string[]) => cells.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd();
  return `${title}\n${[header, ...body].map(line).join('\n')}`;
}

function speedTable(value: unknown): string {
  const speeds = Array.isArray(value) ? value.map(record) : [];
  return table('Model speed', ['Model', 'Role', 'Calls', 'Avg min', 'Longest', 'Tokens/s', 'Tokens/call'],
    speeds.map((s) => [text(s.model), text(s.role), text(s.calls), text(s.averageMinutes), text(s.longestMinutes), text(s.outputTokensPerSecond), text(s.outputTokensPerCall)]));
}

const spendRowLimit = 10;
function spendTable(title: string, value: unknown): string {
  const rows = Array.isArray(value) ? value.map(record).slice(0, spendRowLimit) : [];
  return table(title, ['Name', 'Est. $', 'Priced from', 'pi est. $', 'Calls', 'Turns', 'New input', 'Cached', 'Output'],
    rows.map((r) => [text(r.key), text(r.estimatedCost), text(r.costSource), text(r.piEstimate), text(r.calls), text(r.turns), text(r.inputTokens), text(r.cacheReadTokens), text(r.outputTokens)]));
}

function slowSection(value: unknown): string {
  const slow = Array.isArray(value) ? value.map(text) : [];
  return slow.length ? `Slow models\n${slow.map((note) => `- ${note}`).join('\n')}` : '';
}

function renderNext(value: unknown): string {
  const v = record(value);
  const pairs: Row[] = [];
  for (const [key, item] of Object.entries(v)) {
    if (key === 'action' || key === 'parallel' || item === undefined) continue;
    pairs.push([humanLabel(key), summarize(item)]);
  }
  const parallel = record(v.parallel);
  if (v.parallel) {
    pairs.push(['Ready', idList(parallel.ready, 'id')]);
    pairs.push(['Running', idList(parallel.running, 'id')]);
  }
  return report(`Next action — ${text(v.action)}`, pairs);
}

function renderDiagnose(value: unknown): string {
  const v = record(value), state = record(v.state), runDiagnostics = record(v.diagnostics);
  const totals = record(runDiagnostics.totals), health = record(v.health), ledger = record(v.hostActions);
  const spendTotal = record(record(record(health.metrics).spend).total);
  const phases = Array.isArray(state.phaseStatus) ? state.phaseStatus.map(record) : [];
  const records = Array.isArray(ledger.records) ? ledger.records.length : 0;
  const unreadable = Array.isArray(ledger.unreadable) ? ledger.unreadable.length : 0;
  const healthSummary = health.available === true
    ? `${Array.isArray(health.warnings) ? health.warnings.length : 0} warning(s)`
    : text(health.reason);
  const body = report(`Diagnostics for ${text(state.run)}${v.stateError ? ' — state unreadable' : ''}`, [
    ['State error', text(v.stateError)],
    ['Intent', text(state.intent)],
    ['Host', `${text(record(state.host).kind)} / ${text(record(state.host).model)}`],
    ['Next action', text(record(state.next).action)],
    ['Tasks', phases.length ? phases.map((phase) => `${text(phase.id)}:${text(phase.status)}`).join(', ') : 'none planned'],
    ['Operations', `${text(totals.operations)} total, ${text(totals.failures)} failed, ${text(totals.unfinished)} unfinished`],
    ['Cost', spendTotal.estimatedCost === undefined
      ? `${dollars(totals.reportedCost)} reported, ${dollars(totals.estimatedCost)} estimated by pi`
      : `${dollars(totals.reportedCost)} reported, ${dollars(spendTotal.estimatedCost)} estimated from ${text(spendTotal.costSource)} (pi estimated ${dollars(totals.estimatedCost)})`],
    ['Tokens', `${text(totals.inputTokens)} in / ${text(totals.outputTokens)} out`],
    ['Host actions', `${records} recorded, ${unreadable} unreadable`],
    ['Health', healthSummary],
  ]);
  return [body, slowSection(health.slowModels)].filter(Boolean).join('\n\n');
}

function renderPreflight(value: unknown): string {
  const v = record(value);
  return report(`Preflight — ${v.ready === true ? 'ready' : text(v.action)}`, [
    ['Network', `${text(v.network)} (host-declared)`],
    ['Channel', text(v.channel)],
    ['Model', text(v.model)],
    ['Confidence', v.confidence === undefined ? none : text(v.confidence)],
    ['HTTP status', text(v.status)],
    ['Reason', text(v.reason)],
    ['Elapsed', v.elapsedMs === undefined ? none : `${text(v.elapsedMs)} ms`],
    ['Project export authorized', v.projectExportAuthorized === true ? 'yes' : 'no'],
    ['Artifact', text(v.artifact)],
  ]);
}

const renderers: Record<string, (value: unknown) => string> = {
  doctor: renderDoctor,
  list: renderList,
  status: renderStatus,
  health: renderHealth,
  next: renderNext,
  diagnose: renderDiagnose,
  preflight: renderPreflight,
};

// The fallback pretty-prints anything without a renderer of its own.
export function renderHuman(operation: string, value: unknown): string {
  const renderer = renderers[operation];
  return renderer ? renderer(value) : JSON.stringify(value, null, 2);
}

// One decision point: a person at a terminal sees a report, unless --json asks
// for the machine record. Everything else keeps the JSON contract untouched.
export function humanRequested(argv: string[], interactive: boolean | undefined): boolean {
  if (argv.includes('--json')) return false;
  return interactive === true;
}

export function stripFlags(argv: string[]): string[] {
  return argv.filter((argument) => argument !== '--json');
}

export function renderResult(operation: string, value: unknown, human: boolean): string {
  return human ? renderHuman(operation, value) : JSON.stringify(value, null, 2);
}
