import HeroCanvas from "./HeroCanvas";
import { asset } from "../../lib/paths";
import { SponsorButton } from "../ProjectActions";

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
      {/* Below lg the scene is its own band under the copy, zoomed onto the
          model tiles: the 16 by 9 scene box is wider than the band and
          translated so the tile cluster's centre (x 13, y 4.7 of the design
          box) sits at the band's centre, i.e. -13/16 and -4.7/9 of its size. */}
      <div class="relative mt-8 aspect-[8/9] overflow-hidden sm:aspect-[16/10] lg:absolute lg:inset-0 lg:-z-10 lg:mt-0 lg:aspect-auto">
        <div class="absolute left-1/2 top-1/2 aspect-[16/9] w-[250%] -translate-x-[81.25%] -translate-y-[52.2%] sm:w-[150%] lg:inset-0 lg:aspect-auto lg:w-auto lg:translate-x-0 lg:translate-y-0">
          <HeroCanvas />
        </div>
      </div>
    </section>
  );
}
