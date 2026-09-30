import HeroCanvas from "./HeroCanvas";
import { asset } from "../../lib/paths";
import { SponsorButton } from "../ProjectActions";
import { HERO_FOCUS } from "../../lib/hero-scene";

export default function Problem() {
  return (
    <section class="relative isolate overflow-hidden lg:min-h-[36rem]">
      <div class="relative mx-auto w-full max-w-7xl px-4 pt-16 sm:px-6 md:pt-24 lg:pb-8">
        <div class="animate-rise max-w-xl">
          <h1 class="font-display text-hero font-semibold tracking-tight">
            Your expensive model directs. Cheap Flash delivers.
          </h1>
          <p class="mt-5 max-w-prose text-lg leading-relaxed text-dim">
            Each chunk is built by a cheap Flash model, then reviewed by a different model family before it can merge.
          </p>
          <div class="mt-8 flex flex-wrap gap-3">
            <a
              class="btn btn-primary font-semibold rounded-field"
              href={asset('docs/getting-started/')}
            >
              Get started
            </a>
            <SponsorButton location="hero" />
          </div>
        </div>
      </div>
      <div class="relative mt-8 aspect-[3/4] w-full overflow-hidden sm:aspect-[4/3] lg:absolute lg:inset-0 lg:-z-10 lg:mt-0 lg:aspect-auto">
        <div
          class="absolute left-1/2 top-1/2 aspect-[2/1] w-[300%] [transform:translate(-78.8889%,calc(-1*var(--hero-focus-y)))] sm:aspect-[8/3] sm:w-[225%] sm:[transform:translate(-71.6667%,calc(-1*var(--hero-focus-y)))] lg:inset-0 lg:aspect-auto lg:w-auto lg:[transform:none]"
          style={{ '--hero-focus-y': `${(HERO_FOCUS.y / 9) * 100}%` }}
        >
          <HeroCanvas />
        </div>
      </div>
    </section>
  );
}
