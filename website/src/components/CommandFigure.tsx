import CopyButton from './CopyButton';
import { recordWin } from '../lib/wins';


export interface CommandFigureProps {
  label: string;
  command: string;
  location: string;
  class?: string;
}

const figureClass =
  'overflow-hidden rounded-box border border-line bg-base-200 shadow-rest';

export default function CommandFigure(props: CommandFigureProps) {
  function selectionInside(node: HTMLElement): boolean {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    return node.contains(range.commonAncestorContainer);
  }

  function onCopy(event: ClipboardEvent) {
    if (event.defaultPrevented) return;
    if (!selectionInside(event.currentTarget as HTMLElement)) return;
    recordWin('install_copied', props.location);
  }

  return (
    <figure class={props.class ? `${figureClass} ${props.class}` : figureClass}>
      <div class="flex items-center justify-between border-b border-line px-4 py-2.5 font-mono text-xs text-dim">
        <span>{props.label}</span>
        <CopyButton text={props.command} location={props.location} />
      </div>
      <pre class="overflow-x-auto p-4 font-mono text-sm leading-relaxed" onCopy={onCopy}>
        <code>{props.command}</code>
      </pre>
    </figure>
  );
}
