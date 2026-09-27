import { createSignal, onCleanup } from 'solid-js';
import { recordWin } from '../lib/wins';


type CopyState = 'idle' | 'copied' | 'failed';

const copyLabel: Record<CopyState, string> = {
  idle: 'Copy',
  copied: 'Copied',
  failed: 'Copy failed',
};

const resetAfterMs = 2000;

export interface CopyButtonProps {
  text: string;
  location: string;
}

export default function CopyButton(props: CopyButtonProps) {
  const [state, setState] = createSignal<CopyState>('idle');
  let reset: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => clearTimeout(reset));

  function armReset() {
    clearTimeout(reset);
    reset = setTimeout(() => setState('idle'), resetAfterMs);
  }

  async function copy() {
    let written = false;
    try {
      await navigator.clipboard.writeText(props.text);
      written = true;
    } catch {
      written = false;
    }
    setState(written ? 'copied' : 'failed');
    if (written) recordWin('install_copied', props.location);
    armReset();
  }

  return (
    <button
      type="button"
      class="btn btn-sm btn-ghost rounded-field font-sans text-dim hover:text-base-content"
      onClick={() => void copy()}
    >
      {copyLabel[state()]}
    </button>
  );
}
