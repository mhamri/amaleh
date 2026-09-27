# Website dependency verification

Versions below were checked against authoritative release sources on **2026-09-20**. Dependencies are pinned in `package.json`; `package-lock.json` records the resolved installation. CI uses `npm ci`.

| Dependency | Selected stable version | Authoritative source |
| --- | --- | --- |
| SolidStart | 2.0.5 | [npm registry](https://registry.npmjs.org/@solidjs%2fstart/latest) |
| Nitro (compatibility exception) | 3.0.260903-beta | [Registry metadata](https://registry.npmjs.org/nitro/3.0.260903-beta) |
| Solid | 1.9.15 | [npm registry](https://registry.npmjs.org/solid-js/latest) |
| Solid Router | 1.0.0 | [npm registry](https://registry.npmjs.org/@solidjs%2frouter/latest) |
| Solid Meta | 0.29.4 | [npm registry](https://registry.npmjs.org/@solidjs%2fmeta/latest) |
| daisyUI | 5.7.42 | [npm registry](https://registry.npmjs.org/daisyui/latest) |
| Tailwind CSS | 4.3.3 | [npm registry](https://registry.npmjs.org/tailwindcss/latest) |
| Tailwind Vite plugin | 4.3.3 | [npm registry](https://registry.npmjs.org/@tailwindcss%2fvite/latest) |
| Vite | 8.3.0 | [npm registry](https://registry.npmjs.org/vite/latest) |
| TypeScript | 7.0.2 | [npm registry](https://registry.npmjs.org/typescript/latest) |
| Node type definitions | 26.6.2 | [npm registry](https://registry.npmjs.org/@types%2fnode/latest) |
| Bricolage Grotesque (variable font, self-hosted) | 5.3.0 | [npm registry](https://registry.npmjs.org/@fontsource-variable%2fbricolage-grotesque/latest) |
| Spline Sans Mono (self-hosted) | 5.3.0 | [npm registry](https://registry.npmjs.org/@fontsource%2fspline-sans-mono/latest) |
| Node.js | 26.9.0 | [Official distribution index](https://nodejs.org/dist/index.json) |
| GitHub Actions runner | Ubuntu 26.04 | [General availability announcement, September 17, 2026](https://github.blog/changelog/2026-09-17-ubuntu-26-generally-available-and-latest-migration/) |
| actions/checkout | 7.0.1 | [Official release](https://github.com/actions/checkout/releases/tag/v7.0.1) |
| actions/setup-node | 7.0.0 | [Official release](https://github.com/actions/setup-node/releases/tag/v7.0.0) |
| actions/configure-pages | 6.0.0 | [Official release](https://github.com/actions/configure-pages/releases/tag/v6.0.0) |
| actions/upload-pages-artifact | 5.0.0 | [Official release](https://github.com/actions/upload-pages-artifact/releases/tag/v5.0.0) |
| actions/deploy-pages | 5.0.1 | [Official release](https://github.com/actions/deploy-pages/releases/tag/v5.0.1) |

Nitro is the one prerelease exception. Installing stable Nitro 3.0.0 reproducibly failed with npm ERESOLVE: Nitro requires optional peer Vite ^7, while stable SolidStart 2.0.5 requires Vite ^8 or ^9. The registry's current 3.0.260903-beta adapter is selected to retain stable SolidStart and Vite without forcing incompatible peers. No stable Nitro release satisfies this combination. Revisit the exception when a compatible stable adapter is published.

## Pages CI contract

Pull requests run installation, type checking, the prerendered production build, and static-output checks without deployment permissions. Pushes and manual runs deploy only when targeting the repository's default branch, and only after those checks pass. The artifact is `website/.output/public`.

The workflow derives `SITE_BASE` as `/repository-name/`, or `/` for an `owner.github.io` repository. Set the repository Actions variable `SITE_BASE` to `/` for a custom domain, or to another required absolute path. Enable **Settings → Pages → Source → GitHub Actions** before the first deployment.

## Verification gates

Run `npm ci`, `npm run check`, `npm run build`, and `npm run test:static` from `website`. This document records version selection and the required gates; it does not claim a successful remote CI run or deployment.
