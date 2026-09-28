import models from '../../../amaleh/models.json' with { type: 'json' };
import { family } from '../../../amaleh/scripts/family.ts';
import { MODELS, type ModelIdentity } from './models.ts';

function identity(id: string): ModelIdentity {
  const key = family(id);
  const found = (MODELS as Record<string, ModelIdentity | undefined>)[key];
  if (!found) {
    throw new Error(
      `amaleh/models.json routes ${id} to the family '${key}', which website/src/lib/models.ts has no identity for. ` +
      `Add a '${key}' identity to MODELS in website/src/lib/models.ts before building.`,
    );
  }
  return found;
}

function list(ids: string[]): ModelIdentity[] {
  const out: ModelIdentity[] = [];
  for (const id of ids) {
    const found = identity(id);
    if (!out.includes(found)) out.push(found);
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

export const WORKERS: ModelIdentity[] = list(models.flash ?? []);
if (WORKERS.length < 2) {
  throw new Error(
    `amaleh/models.json routes ${WORKERS.length} flash famil${WORKERS.length === 1 ? 'y' : 'ies'} for website/src/lib/pool.ts to name, and the site's cross-family review text needs at least two. ` +
    `Add another flash model family to amaleh/models.json before building.`,
  );
}
export const WORKER_NAMES: string[] = WORKERS.map((worker) => worker.name);
export const REPAIR: ModelIdentity = identity(required(models.deep?.[0], 'deep'));
export const DECISION: ModelIdentity = identity(required(models.jev, 'jev'));

export function joinNames(names: string[]): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

export const WORKER_LIST: string = joinNames(WORKER_NAMES);
