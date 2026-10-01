import HeroCanvas, { HeroSceneBox } from "./HeroCanvas";
import { asset } from "../../lib/paths";
import { SponsorButton } from "../ProjectActions";

export default function Problem() {
  return (
    <section class="relative isolate overflow-hidden">
      <HeroCanvas>
        <div class="relative mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 pb-14 pt-16 sm:px-6 sm:pb-16 md:pt-24 xl:flex-row xl:items-start xl:gap-12 xl:pb-24">
          <div class="animate-rise w-full max-w-xl xl:max-w-md">
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
          <HeroSceneBox
            direction="narrow"
            class="mx-auto w-full max-w-[390px] sm:hidden"
          />
          <HeroSceneBox
            direction="wide"
            class="mx-auto w-full max-w-[760px] hidden sm:block xl:flex-1"
          />
        </div>
      </HeroCanvas>
    </section>
  );
}
