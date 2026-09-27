
import { recordWin } from './wins';

const visibleMsTarget = 30_000;
const scrollFractionTarget = 0.5;
const heartbeatMs = 1000;

function currentScrollFraction(): number {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  return scrollable > 0 ? window.scrollY / scrollable : 0;
}

export function startEngagedVisitTracking(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  let visibleMs = 0;
  let visible = document.visibilityState === 'visible';
  let lastAt = performance.now();
  let deepest = currentScrollFraction();
  let timer: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    document.removeEventListener('visibilitychange', beat);
    window.removeEventListener('scroll', beat);
  };

  function beat(): void {
    const now = performance.now();
    if (visible) visibleMs += now - lastAt;
    lastAt = now;
    visible = document.visibilityState === 'visible';
    deepest = Math.max(deepest, currentScrollFraction());
    if (visibleMs >= visibleMsTarget && deepest >= scrollFractionTarget) {
      stop();
      recordWin('engaged_visit');
    }
  }

  document.addEventListener('visibilitychange', beat);
  window.addEventListener('scroll', beat, { passive: true });
  timer = setInterval(beat, heartbeatMs);
  beat();
}