import { recordWin } from '../lib/wins';
import { REPOSITORY_URL, SPONSOR_URL } from '../lib/links';
import { openStarCheck } from '../lib/star-check';

// See website/DESIGN-SYSTEM.md — the Sponsor and Star button patterns.
const secondaryButton = 'btn btn-outline border-line text-base-content hover:bg-base-200';

interface ProjectActionProps {
  class?: string;
  location?: string;
}

function buttonClass(props: ProjectActionProps) {
  return props.class ? `${secondaryButton} ${props.class}` : secondaryButton;
}

export function SponsorButton(props: ProjectActionProps) {
  return (
    <a
      class={buttonClass(props)}
      href={SPONSOR_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => recordWin('sponsor_click', props.location)}
    >
      <svg viewBox="0 0 24 24" class="size-4 shrink-0" aria-hidden="true">
        <path
          fill="#db61a2"
          d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
        />
      </svg>
      Sponsor
    </a>
  );
}

export function StarButton(props: ProjectActionProps) {
  return (
    <a
      class={buttonClass(props)}
      href={REPOSITORY_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        recordWin('star_click', props.location);
        openStarCheck();
      }}
    >
      <svg viewBox="0 0 24 24" class="size-4 shrink-0" fill="currentColor" aria-hidden="true">
        <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
      </svg>
      Star on GitHub
    </a>
  );
}