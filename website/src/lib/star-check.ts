// See website/DESIGN-SYSTEM.md — the star check panel pattern.

import { createSignal } from 'solid-js';
import { REPOSITORY_URL } from './links';

export type StarCheckState =
  | 'ask'
  | 'checking'
  | 'verified'
  | 'already'
  | 'not-found'
  | 'no-user'
  | 'busy'
  | 'invalid'
  | 'error';

export const firstStarClickKey = 'amaleh_first_star_click';
export const starVerificationWindowMs = 5 * 60 * 1000;
export const starListApi = 'https://api.github.com/users/';
export const starListAccept = 'application/vnd.github.star+json';

export const [starCheckOpen, setStarCheckOpen] = createSignal(false);

let firstStarClickFallback = 0;

function storedFirstStarClick(): number {
  try {
    const stored = Number(window.localStorage.getItem(firstStarClickKey));
    if (Number.isFinite(stored) && stored > 0) return stored;
  } catch {
  }
  return 0;
}

export function firstStarClickTime(): number {
  return storedFirstStarClick() || firstStarClickFallback;
}

export function rememberStarClick(): void {
  const now = Date.now();
  if (firstStarClickTime() === 0) firstStarClickFallback = now;
  try {
    if (window.localStorage.getItem(firstStarClickKey) === null) {
      window.localStorage.setItem(firstStarClickKey, String(now));
    }
  } catch {
  }
}

export function openStarCheck(): void {
  rememberStarClick();
  setStarCheckOpen(true);
}

export function closeStarCheck(): void {
  setStarCheckOpen(false);
}

export function isGitHubUsername(name: string): boolean {
  return name.length >= 1 && name.length <= 39 && /^[A-Za-z0-9](-?[A-Za-z0-9])*$/.test(name);
}

export function repositoryFullName(): string {
  return new URL(REPOSITORY_URL).pathname.replace(/^\/+/, '').replace(/\/+$/, '');
}

interface StarredEntry {
  fullName: string;
  starredAt: string;
}

function starredEntry(value: unknown): StarredEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const entry = value as { repo?: { full_name?: unknown }; starred_at?: unknown };
  const fullName = entry.repo?.full_name;
  if (typeof fullName !== 'string') return undefined;
  return { fullName, starredAt: typeof entry.starred_at === 'string' ? entry.starred_at : '' };
}

export async function checkStar(name: string, firstClickAt: number): Promise<StarCheckState> {
  try {
    const response = await fetch(`${starListApi}${encodeURIComponent(name)}/starred?per_page=100`, {
      headers: { Accept: starListAccept },
    });
    if (response.status === 404) return 'no-user';
    if (response.status === 403 || response.status === 429) return 'busy';
    if (!response.ok) return 'error';

    const body: unknown = await response.json();
    if (!Array.isArray(body)) return 'error';

    const wanted = repositoryFullName().toLowerCase();
    const entry = (body as unknown[])
      .map(starredEntry)
      .find((item) => item !== undefined && item.fullName.toLowerCase() === wanted);
    if (entry === undefined) return 'not-found';

    const starredAt = Date.parse(entry.starredAt);
    if (!Number.isFinite(starredAt)) return 'error';

    return starredAt >= firstClickAt - starVerificationWindowMs ? 'verified' : 'already';
  } catch {
    return 'error';
  }
}
