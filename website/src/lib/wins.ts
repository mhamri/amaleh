const sessionKeyPrefix = 'amaleh_win_';
export const starVerifiedKey = 'amaleh_win_star_verified';

export const winNames = ['engaged_visit', 'install_copied', 'star_click', 'sponsor_click', 'star_verified'] as const;

export type WinName = (typeof winNames)[number];

function winStorage(win: WinName): Storage | undefined {
  try {
    return win === 'star_verified' ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
}

function winStorageKey(win: WinName): string {
  return win === 'star_verified' ? starVerifiedKey : sessionKeyPrefix + win;
}

export function recordWin(win: WinName, location?: string): boolean {
  if (typeof window === 'undefined' || !window.dataLayer) return false;

  const storage = winStorage(win);
  const key = winStorageKey(win);
  try {
    if (storage?.getItem(key) === '1') return false;
  } catch {
  }
  try {
    storage?.setItem(key, '1');
  } catch {
  }

  window.dataLayer.push({
    event: 'amaleh_' + win,
    win_id: crypto.randomUUID(),
    ...(location === undefined ? {} : { win_location: location }),
  });
  return true;
}