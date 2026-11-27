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

- Landing page: `src/pages/index.astro`. Screenshot slots are marked `PLACEHOLDER` in comments and on the page.
- Docs: `src/content/docs/docs/*.md`, one page per file. Add a new page to `sidebar` in `astro.config.mjs`.
- Colours: `src/styles/theme.css` (docs) and the top of `index.astro` (landing), both from Kothar's Default theme
  (`packages/ui/src/themes.tsx`).
- Write only what's true on `main`. Words: Kothar, space, chat, worker, extension, engine.

## Cloudflare Pages

Create a Pages project connected to `billwang7599/kothar` with these settings:

| Setting | Value |
|---|---|
| Framework preset | Astro |
| Production branch | `main` |
| Root directory | `website` |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION` = `24` |

No adapter or Functions are needed: the output is static. `site` in `astro.config.mjs` is `https://kothar.sh`;
canonical links and the sitemap use it, so change it if the domain ever changes.

Then, in the Pages project, open **Custom domains** and add `kothar.sh` (and `www.kothar.sh` if wanted). With the
domain's nameservers on Cloudflare, Pages creates the DNS records itself.

To skip builds when only the app changed, set **Build watch paths** to include `website/*`.
