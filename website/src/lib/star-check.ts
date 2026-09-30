// See website/DESIGN-SYSTEM.md — the star check panel pattern.

import { createSignal } from 'solid-js';
import { REPOSITORY_URL } from './links';

export type StarCheckState =
  | 'ask'
  | 'checking'
  | 'verified'
  | 'confirmed'
  | 'partial'
  | 'not-found'
  | 'no-user'
  | 'busy'
  | 'invalid'
  | 'error';

export const firstStarClickKey = 'amaleh_first_star_click';
export const starVerificationWindowMs = 5 * 60 * 1000;
export const starListApi = 'https://api.github.com/users/';
export const starListAccept = 'application/vnd.github.star+json';
export const starListPageSize = 100;
export const starListRequestBound = 10;

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

function nextPageUrl(link: string | null): string | undefined {
  if (link === null) return undefined;
  for (const part of link.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part.trim());
    if (match) return match[1];
  }
  return undefined;
}

export async function checkStar(name: string, firstClickAt: number): Promise<StarCheckState> {
  const wanted = repositoryFullName().toLowerCase();
  let url: string | undefined = `${starListApi}${encodeURIComponent(name)}/starred?per_page=${starListPageSize}`;
  let requests = 0;
  try {
    while (url !== undefined && requests < starListRequestBound) {
      const current: string = url;
      requests += 1;
      const response = await fetch(current, {
        headers: { Accept: starListAccept },
        cache: 'no-store',
      });
      if (response.status === 404) return 'no-user';
      if (response.status === 403 || response.status === 429) return 'busy';
      if (!response.ok) return 'error';

      const body: unknown = await response.json();
      if (!Array.isArray(body)) return 'error';

      const entry = (body as unknown[])
        .map(starredEntry)
        .find((item) => item !== undefined && item.fullName.toLowerCase() === wanted);
      if (entry !== undefined) {
        const starredAt = Date.parse(entry.starredAt);
        if (!Number.isFinite(starredAt)) return 'error';
        return starredAt >= firstClickAt - starVerificationWindowMs ? 'verified' : 'confirmed';
      }

      url = nextPageUrl(response.headers.get('Link'));
    }
    return url === undefined ? 'not-found' : 'partial';
  } catch {
    return 'error';
  }
}
