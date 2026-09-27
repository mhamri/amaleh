# Website verification

Observed locally on 2026-09-22 using Node 24.19.0 (additional local compatibility, not the latest release) and the committed package lock. CI targets the separately verified latest stable Node.

- `npm ci --no-audit --no-fund`: installed successfully from the lockfile.
- `npm run check`: TypeScript strict mode passed.
- `npm run build` prerenders seven content routes via nitro's link crawler with `failOnError: true`: `/`, `/docs/`, `/case-study/`, `/docs/getting-started/`, `/docs/workflow/`, `/docs/review-and-recovery/` and `/docs/commands/`. Each route renders to complete HTML with a heading and a `<title>`. No page links `/evidence/` any more, so `vite.config.ts` names it in nitro's `prerender.routes` and it is prerendered as a redirect to `/case-study/`: the evidence page was replaced by the case study, and the redirect keeps links written against the old route working. The meta refresh and the fallback link are both built through `asset()`, so they resolve under `SITE_BASE=/` and `SITE_BASE=/amaleh/`.
- `npm run build:all` (`scripts/build.mjs`) runs the prepare step, that prerendering build and the postbuild step from one command, which is what an automated check can spawn in a single call.
- `npm run test:static` passes for both `SITE_BASE=/` and `SITE_BASE=/amaleh/`. The checker asserts headings, titles, brand (عمله with pronunciation Ah-mah-leh and meaning workers / laborers) on index.html, docs/index.html and case-study/index.html only, metadata, unique element ids, link and asset containment within the configured base path, resolvable link targets and anchor targets, a shipped `.nojekyll`, no private or build files in the output, and WCAG AA 4.5:1 contrast for every foreground/background pair declared in the design system. The brand assertion is gated to those three routes because only they carry the name in body copy; the other four routes are checked for headings, titles, metadata, ids, link containment and resolvable targets.
- `npm run test:static` additionally walks each prerendered route with an ancestor-tracking element scanner and fails the build when a route puts a `badge-neutral` or otherwise hueless chip on a card surface, when a section container is narrower than `max-w-7xl`, or when a documentation route carries no `figure` containing a diagram. It also reproduces daisyUI's soft-badge fill by mixing each hue 8 percent into `base-100` in oklab and asserts at least 4.5:1 for primary, secondary, accent, info, success, warning and error, so a palette edit that makes a chip unreadable fails rather than ships.
- `npm run test:static` carries the brand-asset assertions: it fails when a built page references the deleted `mark.svg`, when the master logo (`brand/amaleh-logo-transparent.png`, caught by name and by exact byte length) is shipped or referenced, when a page references a file under `public/brand/` that `website/src/lib/brand.ts` does not register, and when a referenced brand image is over its registered byte limit.
- `npm run test:static` carries the Sponsor and Star button assertions on every built page: every link to `SPONSOR_URL` opens in a new tab and shows the `#db61a2` heart before its `Sponsor` label, every header carries an external Star on GitHub button with a `currentColor` star before its label and no plain "GitHub" link, the hero keeps exactly two buttons and no repository link, the final call to action keeps its Sponsor button beside an external Star on GitHub button, `SPONSOR_URL` is referenced only by `website/src/components/ProjectActions.tsx` (the sponsor URL literal lives only in `website/src/lib/links.ts`), the heart measures at least 3:1 on `base-100`, and `website/DESIGN-SYSTEM.md` records the heart colour and its measured 5.58:1 contrast.
- `npm run test:seo` (`website/scripts/check-seo.mjs`) passes and runs in CI: it verifies canonical, Open Graph and Twitter tags, escaped schema.org JSON-LD, `/evidence/` noindexed with a canonical to `/case-study/`, and a sitemap plus its own route set derived from the prerendered output — the rules are stated in `website/SEO.md`.
- `npm run test:wins` (`website/scripts/check-wins.mjs`) runs every browser check in `website/scripts/wins-checks/` against the built site. The shared harness `website/scripts/browser-harness.mjs` serves the local build, answers a mocked `api.github.com`, and aborts every other request.
- Headless Chromium render probe over every prerendered route in `website/.output/public`, at 320, 390, 768, 1024 and 1440 CSS pixels: no horizontal overflow on any route at any of those widths, one `<h1>` per route, and zero console or page errors. The landing route renders one `<canvas>` and seven SVG text labels; the four documentation pages that carry a topic diagram render 5, 2, 2 and 38 figures and 38, 28, 43 and 85 SVG text labels respectively.
- Same probe with JavaScript disabled: every SVG text label count is unchanged, so the hero structure and every diagram are fully server-rendered rather than drawn on the client.
- Same probe with `prefers-reduced-motion: reduce` forced: every route schedules zero `requestAnimationFrame` callbacks of its own and reports zero running Web Animations, so the hero canvas and every diagram timeline stay still.
- SVG label geometry probe: every `<text>` box inside every diagram measured with `getBBox` against its own `viewBox` at 320, 768 and 1440 CSS pixels. Zero labels escape a viewBox and zero label pairs overlap. This check exists because two clipped or colliding labels passed both the type check and the static check before a browser was pointed at the built pages.

## Routes and verification state

The production build prerenders all seven content routes plus the `/evidence/` redirect under both `/` and `/amaleh/`. Both builds were run and verified in this delivery task: `SITE_BASE=/amaleh/ node ./node_modules/vite/bin/vite.js build` prerendered nine routes (including `/amaleh/` itself and `/amaleh/evidence/`) and `SITE_BASE=/amaleh/ node scripts/check-static.mjs` reported "Static verification passed: 7 fully rendered routes ... at Pages base /amaleh/"; the root build (`SITE_BASE` unset) prerenders the seven content routes plus `/evidence/` without the `/amaleh/` prefix and `node scripts/check-static.mjs` reports the same at Pages base `/`. The routes are:

| Route | File | Notes |
| --- | --- | --- |
| `/` | `index.html` | Landing page: problem, division of labor, install, continue to docs |
| `/docs/` | `docs/index.html` | Overview: problem, coordinator/worker/reviewer/Jev, routing, host |
| `/docs/getting-started/` | `docs/getting-started/index.html` | Prerequisites, install, credentials, first run |
| `/docs/workflow/` | `docs/workflow/index.html` | Discovery, planning, delegation, parallel execution, verified delivery |
| `/docs/review-and-recovery/` | `docs/review-and-recovery/index.html` | Independent review, coverage, repair escalation, resume, diagnostics |
| `/docs/commands/` | `docs/commands/index.html` | Full CLI operation reference from `amaleh/references/runtime.md` |
| `/case-study/` | `case-study/index.html` | How Amaleh built this site |
| `/evidence/` | `evidence/index.html` | Redirect to `/case-study/`; meta refresh and fallback link both built through `asset()` |

Each route's sidebar and internal links are built through `asset()` from `website/src/lib/paths.ts`, so hrefs carry the configured `SITE_BASE` prefix. `website/vite.config.ts` derives the prerendered route list by crawling links from the home page, not by hand.

The standalone interactive workflow graph ships at the site root as `workflow.html`: `prepare.mjs` reads the repository's `DESIGN.html` and writes it to `public/workflow.html` unchanged — the design shell does not reference `amaleh/references/` so no link rewrite is needed. It is a static file, not a route: nitro's crawler does not follow `.html` links, so it never enters prerendering, and the render probe's route list (prerendered `index.html` files) does not include it. The workflow documentation page links to it as the standalone interactive workflow graph, and the static checker resolves that link to the shipped file under both base paths.

## Static checks

`website/scripts/check-static.mjs` replaced the v1 checker that asserted the removed first version of the site ("Big intent.", `.mobile-nav` with `#why`/`#workflow` anchors, daisyUI `collapse-title` disclosure, and `.terminal-header`/`.footer-bottom` rules in a cream palette that `website/src/style.css` no longer declares). The current checker asserts the site that exists and retains no assertion from the removed version.

Contrast checks read the `--token: #hex` variables from `website/src/style.css` and compute WCAG relative-luminance ratios for a fixed set of foreground/background pairs drawn from the design system's table; the pairs that require derived surfaces (badge and alert content fills) are documented with measured ratios in `DESIGN-SYSTEM.md` instead. The minimum documented ratio (error-content on error) is 7.47:1; all pairs clear the 4.5:1 AA floor with margin.

`npm run build` is followed by a `postbuild` step (`website/scripts/postbuild.mjs`) that removes Vite's chunk manifest directory (`.vite/`) from the published output — nothing in the prerendered HTML references it. The checker's output-sanity pass rejects `.vite` alongside the other private and build paths, so its reappearance fails `npm run test:static`.

The same step removes `.output/nitro.json`, which records the wall-clock time of the build. Nothing in the published site reads it, and while it was present two identical builds produced two different output trees, so no verification that compares a build against the tree it ran on could ever settle. With it gone, two consecutive `npm run build:all` runs hash identically.

## Rendered inspection

Rendered inspection covers five widths — 320, 390, 768, 1024 and 1440 CSS pixels — on every prerendered route, and shows no horizontal overflow at any of them; the header and footer use the shared shell classes and stay inside the viewport. From 1024 pixels upward each page pairs its prose column with a second column of real content rather than leaving a narrow tablet-width column on an empty page, and the documentation pages move their on-page list into a third rail from 1280 pixels, rendering it exactly once at any width.

Motion is stopped two ways, because the CSS rule alone does not reach script-driven animation. The global `@media (prefers-reduced-motion: reduce)` block in `style.css` kills transitions, keyframes and smooth scrolling. On top of that, the hero canvas and every diagram query `matchMedia('(prefers-reduced-motion: reduce)')` themselves, subscribe to its `change` event, pause through an `IntersectionObserver` when off screen and through `visibilitychange` when the tab is hidden, and tear down their frame, observers and listeners on cleanup. Forcing the preference in headless Chromium leaves zero self-scheduled `requestAnimationFrame` callbacks on every route.

The hero canvas degrades in three directions and was inspected in each: with JavaScript disabled, with WebGL unavailable, and with reduced motion set. In all three the server-rendered SVG structure and its labels remain on screen, because that SVG is never removed from the DOM — only its structure group fades once the canvas is live, and the labels stay visible over the animation as real selectable text.

Interactive controls (header dropdown, docs sidebar, on-page list in both positions) are keyboard reachable.

## CI and deployment

`.github/workflows/pages.yml` installs the lockfile, type-checks, builds for the configured `SITE_BASE`, and runs `check-static.mjs` and `npm run test:seo` on pull requests. Pushes or manual runs on the default branch also upload the rendered site and deploy it to GitHub Pages. The production build must be the last step before verification, because the render probe and the static check both read the build and never run it.

Remote GitHub Actions and public deployment have not been executed in this checkout. Pages must be enabled with GitHub Actions as its source, then the change merged to the default branch. No live-deployment success is claimed.

## Scope

Changes are limited to `website/`, `.github/workflows/pages.yml`, root `README.md` and ignore rules. The Amaleh skill runtime under `amaleh/` is unchanged. Primary marketing evidence comes from the shipped `amaleh/references/` files. The public build copies only the explicit source list declared in `website/scripts/prepare.mjs`.

Consumers: website visitors, JS-disabled readers (the initial HTML contains content), assistive technology, GitHub project/root hosting, and maintainers running a clean install. Paths: home/case-study direct entry, source downloads, documentation navigation, clipboard operations, disclosure open/close, build failure, PR validation, default-branch deployment and nondefault-branch rejection. Website preview is a local allowlisted-root server. CI uses separate build/deploy jobs; only deploy holds Pages/OIDC permissions.
