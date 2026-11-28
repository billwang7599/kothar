# Kothar website

The landing page (`/`) and the user docs (`/docs/`), built with [Astro](https://astro.build) and
[Starlight](https://starlight.astro.build) as plain static files. No server code, analytics or trackers, and nothing
loads from another site: the Inter font is bundled.

This folder is its own npm project. It isn't one of the repo's workspaces, so the root `npm ci`, typecheck, lint and
tests don't touch it.

Contributor docs stay in the repo's `docs/` and `CONTRIBUTING.md`; the extension guide stays in
`extension-documentation/`. These pages are for people using Kothar.

## Work on it

```sh
cd website
npm ci
npm run dev       # http://localhost:4321, reloads as you edit
npm run build     # static site in dist/; fails on a broken internal link
npm run preview   # serve dist/
```

- Pages: `src/pages/index.astro` (Overview) and `src/pages/features.astro` (Features). Screenshot slots still waiting
  for an image are marked `PLACEHOLDER` in comments.
- Docs: `src/content/docs/docs/*.md`, one page per file. Add a new page to `sidebar` in `astro.config.mjs`.
- Styles: `src/styles/theme.css` for the docs, from Kothar's Default theme (`packages/ui/src/themes.tsx`), and
  `src/styles/site.css` for Overview and Features.
- Write only what's true on `main`. Words: Kothar, space, chat, worker, extension, engine.

## Deploying (Cloudflare Workers)

The site is the Cloudflare Worker `kothar`, built by **Workers Builds** from `billwang7599/kothar` on every push. Its
build settings (Workers & Pages → kothar → Settings → Build):

| Setting | Value |
|---|---|
| Root directory | `website` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Production branch | `main` |

The root directory matters: the repo root has no `build` script and needs Node 26, so a build from there fails.
`wrangler deploy` finds the Astro build in `dist/` and serves it as static assets; no adapter or server code is needed.
Pull requests run the same build as a check (Workers Builds).

Domains: `kothar.sh` and `www.kothar.sh` are custom domains under Workers & Pages → kothar → Domains & Routes, with the
DNS on Cloudflare. `site` in `astro.config.mjs` is `https://kothar.sh`; canonical links and the sitemap use it, so
change it if the domain ever changes.
