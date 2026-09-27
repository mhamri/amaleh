// See website/DESIGN-SYSTEM.md — the star check panel pattern.

import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import {
  checkStar,
  closeStarCheck,
  firstStarClickTime,
  isGitHubUsername,
  repositoryFullName,
  starCheckOpen,
  type StarCheckState,
} from '../lib/star-check';
import { recordWin } from '../lib/wins';
import { SponsorButton } from './ProjectActions';

const sentences: Record<StarCheckState, string> = {
  ask: `Star ${repositoryFullName()} on GitHub, then type your GitHub username so we can confirm it.`,
  checking: 'Checking your star with GitHub.',
  verified: `Thank you — your star on ${repositoryFullName()} is confirmed.`,
  already: `You starred ${repositoryFullName()} before this visit.`,
  'not-found': `That account has no star on ${repositoryFullName()}. Try again with another username.`,
  'no-user': 'GitHub has no user with that username.',
  busy: 'GitHub is asking us to slow down. Try again in a minute.',
  invalid: 'That is not a valid GitHub username. Use 1 to 39 letters, digits or single hyphens.',
  error: 'The check could not be completed.',
};

export default function StarCheck() {
  const [state, setState] = createSignal<StarCheckState>('ask');
  const [username, setUsername] = createSignal('');
  let field: HTMLInputElement | undefined;

  createEffect(() => {
    if (!starCheckOpen()) return;
    setState('ask');
    setUsername('');
    field?.focus();
  });

  createEffect(() => {
    if (!starCheckOpen()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeStarCheck();
    };
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const name = username().trim();
    if (!isGitHubUsername(name)) {
      setState('invalid');
      return;
    }
    setState('checking');
    void checkStar(name, firstStarClickTime()).then((result) => {
      setState(result);
      if (result === 'verified') recordWin('star_verified');
    });
  };

  return (
    <Show when={starCheckOpen()}>
      <div
        data-star-check
        data-star-check-state={state()}
        role="dialog"
        aria-labelledby="star-check-title"
        class="fixed inset-x-4 top-20 z-40 mx-auto max-w-md rounded-box border border-line bg-base-200 p-5 shadow-floating"
      >
        <h2 id="star-check-title" class="font-display text-title font-semibold tracking-tight">
          Confirm your star
        </h2>
        <p role="status" aria-live="polite" class="mt-2 text-sm leading-relaxed text-dim">
          {sentences[state()]}
        </p>
        <Show when={state() === 'verified'}>
          <div class="mt-4">
            <SponsorButton location="star-check" />
          </div>
        </Show>
        <form class="mt-4" onSubmit={submit}>
          <label class="block font-mono text-sm text-dim" for="star-check-username">
            GitHub username
          </label>
          <input
            ref={field}
            id="star-check-username"
            name="username"
            type="text"
            autocomplete="off"
            autocapitalize="none"
            spellcheck={false}
            class="input mt-2 w-full rounded-field text-sm"
            value={username()}
            onInput={(event) => setUsername(event.currentTarget.value)}
          />
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <button type="submit" class="btn btn-outline border-line text-base-content hover:bg-base-200">
              Check star
            </button>
            <button
              type="button"
              class="btn btn-ghost text-dim hover:text-base-content"
              onClick={() => closeStarCheck()}
            >
              Not now
            </button>
          </div>
        </form>
      </div>
    </Show>
  );
}
