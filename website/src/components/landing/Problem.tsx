import HeroCanvas from "./HeroCanvas";
import { asset } from "../../lib/paths";
import { SponsorButton } from "../ProjectActions";

export default function Problem() {
  return (
    <section class="relative">
      <div class="relative mx-auto w-full max-w-7xl px-4 pt-16 sm:px-6 md:pt-24 lg:pb-8">
        <div class="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center lg:gap-8">
          <div class="animate-rise max-w-xl lg:max-w-md">
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
          <div class="w-full">
            <div class="hidden sm:block">
              <HeroCanvas direction="wide" />
            </div>
            <div class="-mx-4 sm:hidden">
              <HeroCanvas direction="narrow" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
