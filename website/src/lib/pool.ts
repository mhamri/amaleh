import models from '../../../amaleh/models.json' with { type: 'json' };
import { family } from '../../../amaleh/scripts/family.ts';
import { MODELS, type ModelIdentity } from './models.ts';

function identity(key: string): ModelIdentity {
  const found = (MODELS as Record<string, ModelIdentity | undefined>)[key];
  if (!found) {
    throw new Error(
      `amaleh/models.json routes a routed model to the family '${key}', which website/src/lib/models.ts has no identity for. ` +
      `Add a '${key}' identity to MODELS in website/src/lib/models.ts before building.`,
    );
  }
  return found;
}

function keys(ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const key = family(id);
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `amaleh/models.json has no '${field}' model id for website/src/lib/pool.ts to resolve in website/src/lib/models.ts. ` +
      `Set '${field}' in amaleh/models.json before building.`,
    );
  }
  return value;
}

export const WORKER_FAMILIES: string[] = keys(models.flash ?? []);
export const WORKERS: ModelIdentity[] = WORKER_FAMILIES.map(identity);
if (WORKERS.length < 2) {
  throw new Error(
    `amaleh/models.json routes ${WORKERS.length} flash famil${WORKERS.length === 1 ? 'y' : 'ies'} for website/src/lib/pool.ts to name, and the site's cross-family review text needs at least two. ` +
    `Add another flash model family to amaleh/models.json before building.`,
  );
}
export const WORKER_NAMES: string[] = WORKERS.map((worker) => worker.name);
export const REPAIR_FAMILY: string = family(required(models.deep?.[0], 'deep'));
export const REPAIR: ModelIdentity = identity(REPAIR_FAMILY);
export const DECISION_FAMILY: string = family(required(models.jev, 'jev'));
export const DECISION: ModelIdentity = identity(DECISION_FAMILY);

function joinWith(names: string[], conjunction: string): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${conjunction} ${names.at(-1)}`;
}

export function joinNames(names: string[]): string {
  return joinWith(names, 'and');
}

export function joinAlternatives(names: string[]): string {
  return joinWith(names, 'or');
}

export const WORKER_LIST: string = joinNames(WORKER_NAMES);
export const WORKER_ALTERNATIVES: string = joinAlternatives(WORKER_NAMES);
