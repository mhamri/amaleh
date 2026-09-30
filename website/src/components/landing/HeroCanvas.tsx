import { onCleanup, onMount } from 'solid-js';
import scenes from 'virtual:hero-scene';
import HeroGraph from './HeroGraph';
import { attachHeroGlow } from './HeroGlow';
import type { HeroDirection } from '../../lib/hero-layout';

const MAX_LABEL_PX = 15.5;

export default function HeroCanvas(props: { direction: HeroDirection }) {
  const scene = () => scenes[props.direction];
  let canvas!: HTMLCanvasElement;
  let fallback: SVGGElement | undefined;

  onMount(() => {
    const glow = attachHeroGlow({ canvas, scene: scene(), fallback: () => fallback });
    onCleanup(glow.stop);
  });

  return (
    <div
      class="relative mx-auto w-full"
      style={{
        'max-width': `${(MAX_LABEL_PX * scene().width) / scene().labelSize}px`,
        'aspect-ratio': `${scene().width} / ${scene().height}`,
      }}
    >
      <canvas
        ref={canvas}
        class="absolute inset-0 size-full"
        style={{ 'mix-blend-mode': 'plus-lighter' }}
        aria-hidden="true"
      />
      <HeroGraph scene={scene()} fallbackRef={(element) => { fallback = element; }} />
    </div>
  );
}
