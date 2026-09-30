declare module 'virtual:hero-scene' {
  import type { HeroScene } from './lib/hero-layout.ts';

  const scenes: { wide: HeroScene; narrow: HeroScene };
  export default scenes;
}
