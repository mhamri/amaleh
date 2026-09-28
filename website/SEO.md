# Amaleh website search and share metadata

This document is a binding contract for what every page publishes to crawlers
and to share cards. `npm run test:seo` (`website/scripts/check-seo.mjs`) reads
the built output under `website/.output/public/` and fails the build when a
page breaks any rule below. It runs in `.github/workflows/pages.yml` after
`npm run test:static`.

## The production address

`SITE_URL` in `website/src/lib/links.ts` is `https://mhamri.github.io/amaleh/`,
the repository's GitHub Pages home. It is written once and never derived from
`import.meta.env.BASE_URL`: a local build with `SITE_BASE=/` must still emit
production canonical, `og:url`, `og:image` and sitemap addresses, because a
crawler must never index a staging origin.

`website/src/lib/seo.ts` builds every absolute address from it:

- `canonicalUrl(path)` joins `SITE_URL` with the route path relative to the
  base, so `canonicalUrl('docs/workflow/')` is
  `https://mhamri.github.io/amaleh/docs/workflow/`.
- `SHARE_IMAGE_URL` is `SITE_URL` plus the `publicPath` of `SHARE_IMAGE` in
  `website/src/lib/brand.ts`.

The author's profile URLs — `GITHUB_PROFILE_URL`, `LINKEDIN_URL` and `X_URL` —
live once in `website/src/lib/links.ts`. The home `Person` in
`src/lib/seo.ts` and the connection links in
`src/components/landing/Author.tsx` both read them there, so the `sameAs`
data Google reads always matches the profiles the page links to.

## Which pages are indexable

The build output decides, not a hand-kept list. Every prerendered
`index.html` is a page. A page whose `meta[name=robots]` contains `noindex` is
hidden; every other page is indexable and must carry everything below. A new
route is therefore checked and listed in the sitemap the moment it is
prerendered, and a route that forgets its metadata fails the build instead of
slipping past it.

## What each indexable page must carry

Every indexable page renders `PageMeta`, which emits through `@solidjs/meta`:

| Tag | Value |
| --- | --- |
| `<title>` | the page's own title |
| `meta[name=description]` | the page's own description |
| `link[rel=canonical]` | `canonicalUrl(path)` |
| `meta[property=og:title]` | the page title |
| `meta[property=og:description]` | the page description |
| `meta[property=og:type]` | `website` |
| `meta[property=og:url]` | `canonicalUrl(path)` |
| `meta[property=og:site_name]` | `Amaleh` |
| `meta[property=og:image]` | `SHARE_IMAGE_URL` |
| `meta[property=og:image:width]` / `:height` | `SHARE_IMAGE.size` from `src/lib/brand.ts` |
| `meta[property=og:image:alt]` | a description of the share image |
| `meta[name=twitter:card]` | `summary` |
| `meta[name=twitter:site]` / `:creator` | `@MHosseinAmri` |

A hidden page's canonical must point at an indexable page. `/evidence/` is the
one hidden page: a redirect that renders `PageMeta` with `noindex` and
`canonicalPath={CASE_STUDY_PATH}`, so its canonical is `/case-study/`. There is
no `robots.txt`: crawlers ignore one below the domain root, so the noindex tag
is the rule that actually holds.

### The share image

`SHARE_IMAGE` in `website/src/lib/brand.ts` is the only place the share image's
path and pixel size are written. `website/scripts/generate-brand-images.mjs`
draws the square at that size, `PageMeta` declares that size in
`og:image:width` and `og:image:height`, and `check-seo.mjs` fails when the
shipped PNG's pixels differ from it. Nothing rewrites built HTML after
rendering.

## Structured data

`website/src/components/StructuredData.tsx` is the only JSON-LD renderer. It
takes a `Graph` typed with `schema-dts` and serialises it with every `<`
escaped as the JSON escape `\u003c`, so page copy can never close the script element. The
builders live in `website/src/lib/seo.ts`:

- `homeGraph(description)` returns one `@graph` with a `WebSite` named Amaleh
  at `SITE_URL`, a free `SoftwareSourceCode` whose `codeRepository` is the
  repository and whose description is the home page's own (no licence claim,
  because no page states the licence), and a `Person` for Mohammad
  Hossein Amri whose `sameAs` lists his GitHub, LinkedIn and X profiles.
- `articleGraph({ crumb, headline, description })` returns a `TechArticle` and
  a `BreadcrumbList` whose last item is `canonicalUrl(crumb.path)`.

Only facts already on the site are allowed: no ratings, no prices beyond
`isAccessibleForFree`, no dates and no claims the pages do not make.

### Breadcrumbs

A crumb is a `{ name, path }` pair, and a URL has one name on every page. The
section crumbs are `HOME_CRUMB` (`Home`, the site root) and `DOCS_CRUMB`
(`Documentation`, `/docs/`). A page's trail is every section whose path is
a prefix of the page's path, followed by the page itself; a page that is itself a
section always carries the section's name, so `/docs/` reads `Documentation`
on its own page and on every page beneath it. `check-seo.mjs` fails when one
URL carries two names.

### Adding structured data to a new route

1. In the route component, name the page's `title`, `description` and `crumb`
   (`{ name, path }`) once as constants. A documentation page below `/docs/`
   passes `crumb.name` to `DocsLayout` as its visible title too. The
   documentation index is the one exception: its crumb is `DOCS_CRUMB`
   (`Documentation`, the section name every docs breadcrumb shares) while its
   visible `DocsLayout` title is `Overview`, the label the docs sidebar uses
   for that page.
2. Render `<PageMeta path={crumb.path} title={title} description={description}
   structuredData={articleGraph({ crumb, headline: title, description })} />`.
   Add a new builder in `website/src/lib/seo.ts` for any other shape.
3. If the route opens a new section with pages beneath it, add its crumb to
   `SECTION_CRUMBS` in `website/src/lib/seo.ts`.
4. Run `npm run build` and `npm run test:seo`.

## The sitemap

`npm run build` runs `website/scripts/postbuild.mjs`, which writes
`website/.output/public/sitemap.xml` from the build output: one absolute
`SITE_URL` address for every indexable page and nothing else — no hidden page,
no `lastmod`, because the site has no measured per-page dates to publish.
`check-seo.mjs` fails when the sitemap and the set of indexable pages differ in
either direction.

The sitemap must be submitted once in Google Search Console for the
`mhamri.github.io/amaleh/` property. It is a one-time action, not part of the
build; after it, Google fetches the sitemap again on its own schedule.
