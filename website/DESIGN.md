# Website design system

The look of kothar.sh: Overview (`/`), Features (`/features/`) and the Wiki (`/docs/`). We call it the **specimen**
look, after the type-specimen sheet it started from: a flat muted-blue field, paper and ink, thin paired column
lines, numbered sections, and an edge-to-edge KOTHAR wordmark.

This file and the code are kept together. Every token below names the CSS variable and the file it lives in. If you
change one, change the other in the same PR. The desktop app has its own design system in `docs/design.md`; this
file covers only `website/`.

| File | What it holds |
|---|---|
| `src/styles/site.css` | Tokens, base, links, buttons, numbered sections, figures, the wordmark, reveals (Overview and Features) |
| `src/styles/theme.css` | The Wiki: Starlight's colour, font and motion variables mapped to the same palette |
| `src/layouts/Site.astro` | Head and social tags, fonts, the pre-paint script (`.js`, `.motion`, `.still`), footer, star count |
| `src/components/Nav.astro` | The sticky nav on Overview and Features |
| `src/components/StarlightHeader.astro` | The Wiki's header, matched to the nav |
| `src/components/Spec.astro` | One numbered section |
| `src/components/replay/` | The engine cards: `Session.astro`, `sessions.ts` (scripts), `replay.ts` (player), `replay.css` |
| `src/scripts/site.ts` | Reveals and smooth in-page jumps |
| `src/pages/index.astro`, `src/pages/features.astro` | The two pages and their own layout rules |

## Colour

There is one scheme on Overview and Features: paper, with a blue field at the top and an ink band at the bottom.
There's no theme switch on those pages. The Wiki has light (paper) and dark (ink), chosen by Starlight's theme menu.

Tokens are in `:root` in `src/styles/site.css`.

| Token | Hex | Use |
|---|---|---|
| `--field` | `#8a9dc4` | The muted blue: the hero, page heads, the nav at the very top, the cut through the wordmark, the closing band's labels |
| `--ink` | `#0e1016` | Text, the solid button, the closing band and footer, the wordmark |
| `--ink-2` | `#262a35` | The solid button on hover |
| `--ink-soft` | `#2b2f39` | Body copy on paper and field |
| `--ink-muted` | `#4a4f5c` | Captions, card engine names, secondary text |
| `--paper` | `#edece6` | The page |
| `--card` | `#f7f6f2` | Engine cards and figure frames |
| `--chip` | `#e2e0d8` | Inline code and user bubbles inside a card |
| `--line` | `rgb(14 16 22 / 0.16)` | Grid lines and hairlines. On ink (`.inked`) it becomes `rgb(237 236 230 / 0.1)` |
| `--line-strong` | `rgb(14 16 22 / 0.25)` | Figure borders |
| `--blue` | `#2563d9` | Focus rings, a card's running state, the Approve button in a card |
| `--amber` | `#9a6400` | A card's waiting state |
| `--green` | `#3f7a4a` | A card's done state |
| `--on-ink-soft` | `#c9c8c2` | Body copy on ink |
| `--on-ink-muted` | `#a9a8a2` | Secondary text on ink |

Screenshots stay as they are: the app's dark theme on a `#121315` mat (`.shot`).

The Wiki's palette is in `src/styles/theme.css` and uses Starlight's variables:

| Starlight variable | Light (paper) | Dark (ink) |
|---|---|---|
| `--sl-color-black` (page) | `#edece6` | `#0e1016` |
| `--sl-color-white` (strongest text) | `#0e1016` | `#edece6` |
| `--sl-color-gray-2` (body text) | `#2b2f39` | `#c9c8c2` |
| `--sl-color-gray-3` (muted) | `#4a4f5c` | `#a9a8a2` |
| `--sl-color-gray-5` (hairlines) | `#cfcdc4` | `#2c2f38` |
| `--sl-color-gray-6` (code, panels) | `#e2e0d8` | `#181b22` |
| `--sl-color-accent` | `#2563d9` | `#8a9dc4` (the field) |
| `--sl-color-accent-low` | `#d3dbec` | `#1d2a45` |
| `--sl-color-accent-high` | `#163d87` | `#d3dbec` |

## Type

| Role | Font | Variable | Licence | Where it comes from |
|---|---|---|---|---|
| Wordmark, headings, body | **Archivo** (variable: weight 100–900, width 62–125%) | `--display` (site.css), `--sl-font` (theme.css) | SIL OFL 1.1 | `@fontsource-variable/archivo/wdth.css` |
| Labels, nav, buttons, code | **IBM Plex Mono** 400 and 600 | `--mono` (site.css), `--sl-font-mono` (theme.css) | SIL OFL 1.1 | `@fontsource/ibm-plex-mono/400.css`, `600.css` |

Both fonts are **self-hosted**. They're npm packages, imported in `src/layouts/Site.astro` and in `customCss` in
`astro.config.mjs`. Astro copies the `.woff2` files into `dist/_astro/`, and the site serves them itself. Never add a
Google Fonts link or any other font CDN. The site makes no requests to Google.

Scale (sizes in px; `clamp` ranges go from 430 px to 1440 px wide):

| Element | Size | Weight / width | Where |
|---|---|---|---|
| Wordmark | Fills the content width (SVG `textLength`) | 900 / 125% | `.word` in site.css |
| Hero headline | `clamp(32px, 4.4vw, 64px)`, line height 0.98, capitals | 900 / 112% | `h1` in index.astro |
| Page title (Features) | `clamp(26px, 3.1vw, 46px)`, capitals | 900 / 112% | `.page-head h1` in site.css |
| Section number | `clamp(56px, 7vw, 104px)`; 52 px on phones | 900 / 125% | `.big` in site.css |
| Hero claim (subline) | `clamp(17px, 1.5vw, 21px)` | 700 / 104% | `.claim` in index.astro |
| Section heading | `clamp(22px, 2.1vw, 30px)`, balanced wrap | 800 / 104% | `.copy h2` in site.css |
| Body | 16 px / 1.5 | 400 / 100% | `body` in site.css |
| Hero facts line | 15 px; 14 px on phones | 400 | `.facts` in index.astro |
| Button | 13 px mono, capitals, +0.04em | 600 | `.btn` in site.css |
| Nav | 12 px mono, capitals, +0.06em | 600 | `.bar` in Nav.astro |
| Label (`.k`) | 11 px mono, capitals, +0.06em | 600 | `.k` in site.css |
| Fine print, captions | 11–12 px mono | 400 | `.fine`, `.fig figcaption` in site.css |

Labels in square brackets (`[ENG]`, `[01]`) are part of the look. They're always mono capitals.

## Grid and spacing

- **Content width:** `--max` (1360 px), with a `--gutter` margin on each side (20 px; 16 px under 640 px). Every band
  uses `.w` for its content.
- **Column lines:** `.lines` draws thin paired vertical lines (1 px each, 10 px apart) across the content width,
  plus a right edge. There are `--cols` columns: 6 wide, 4 under 1000 px, 2 under 640 px. Each band has its own lines
  in the same rhythm, so they line up from band to band. On ink, `--line` gets lighter automatically (`.inked`).
- **Bands:** `.field` (blue), paper (the default), and `.inked` (ink). A page goes field → paper → ink.
- **Insets:** content inside a band sits 10 px in from a column line (`padding-left: 10px` on `.num` and `.copy`), so
  text never touches a line.
- **Rhythm:** sections are 48 px above and 52 px below (36/40 px on phones), with a `--line` hairline between them.
  The contents row ends in a 1.5 px ink rule.

## Numbered sections

`src/components/Spec.astro`, styled by `.spec`, `.num`, `.copy` and `.fig` in site.css. Each one has three columns
in the ratio 1 : 2 : 3:

1. **Number:** the tag in brackets (`[ENG]`), then the big two-digit number.
2. **Words:** the label (`.k`), a heading (`h2`), one paragraph, and a "Read more →" link (`.more`) to the Wiki page.
3. **Figure:** a frame (`.fig`) with a head row (`[ENG] Fig. 01` and where in the app it's from), the screenshot,
   and a caption.

Under 1000 px the columns stack, and the number sits on one line beside its tag. Each page lists its sections at the
top in a **contents row** (`.toc`) of `[NN] Label` links, which jump to each section. Number sections in order,
with two digits. The homepage's closing story continues the count (`06`).

## Components

### Nav (`Nav.astro`)

- Sticky, 56 px high (`--nav-h`).
- Over the blue field at the top of the page (`.top`, under 8 px scrolled), it is the field colour. Once the page
  scrolls, it turns paper with a `--line` hairline, over 220 ms.
- Layout: the `(K)` mark on the left, then Overview, Features and Wiki in the middle, then GitHub and an ink
  Download button on the right.
- The current page's tab is underlined (`aria-current`).
- Under 640 px: the mark, Features and Wiki. Download and GitHub are in the hero.
- The Wiki's header (`StarlightHeader.astro`) is the same, with Starlight's search and theme menu added.

### Buttons (`.btn` in site.css)

- Square corners and a 1.5 px border.
- 42 px high, with 13 px mono capitals.
- Variants:
  - `.solid`: ink, for the main action
  - `.line`: outline, on the field
  - `.paper`: paper fill, on ink
  - `.ghost-light`: outline, on ink
- **Hover:** the button lifts 2 px and a hard 2 px shadow appears under it, like a key. **Press:** it drops back and
  shrinks to 98%. **Focus:** a 2 px `--blue` ring, 3 px out.
- **Star on GitHub:** the star fills on hover. The count slot (`.count`) is always there, so the width never
  changes. The count fades in only if GitHub's API answers with one or more stars (`Site.astro`).
- **Download** always links to `DOWNLOAD` in `src/lib/release.ts`, which is
  `…/releases/latest/download/Kothar-arm64.dmg`. Never hard-code a version.

### Links

- `.ul`: nav and contents links. An underline draws in from the left on hover and focus.
- Links in running copy, `.fine` and the footer are always underlined. The line thickens on hover.
- `.more`: "Read more →" links. The arrow steps 4 px right on hover.

### Engine cards (`components/replay/`)

The hero has five cards, one per engine: Claude Code, Codex, OpenCode, pi and any ACP agent. Each one replays a
short scripted session from `sessions.ts`. They're written by hand, not recorded, and the bar above the cards says
so. Keep that label.

- **First frame:** `Session.astro` renders every step, and marks the steps after the first `first` (default 2) with
  `data-later`.
  - When JS runs and motion is welcome, CSS hides those steps before the first paint. A still frame always shows the
    request and its first tool call. It is never an empty card.
  - Without JS, or with reduced motion (`html.still`), the card shows its final frame.
- **Replay:** `replay.ts` starts each card once, when it is half in view, after its `offset` (0–1000 ms, so the
  cards don't move in lockstep).
  - New steps rise in over 450 ms. Text types in, and tools go running → done.
  - An approval card goes waiting → pressed → allowed.
  - The card then **stops on its final frame. It never loops.**
  - The bar's button reads Pause or Resume while cards play, and Replay once they've all finished.
- **Overflow:** a session pins to the bottom of its 212 px card. Once it no longer fits, the oldest lines fade out
  through the top (`.over`).
- **Narrow windows:** 5 cards above 1100 px, 3 down to 640 px (CC, CX, PI), and 2 on phones (CC, PI).

### Screenshots (`.fig`, `.shot`)

- They're real screenshots of the app's dark theme on a demo project, framed as figures. The caption says so.
- Store them in `src/assets/` as WebP or PNG, and render them with Astro's `<Image>` with `widths` and `sizes`.
- Crop to what the section is about. Paint out any stray text at the crop's edge, and never show a real account or
  email.
- A small popover (`narrow: true`) sits near its real size on the dark mat instead of being stretched.
- Write an `alt` that says what's on screen.

### The wordmark (`.word`)

- One SVG `<text>` stretched to the content width with `textLength`, so it scales with the window and can't
  overflow it.
- In the hero, a 5-unit band of `--field` cuts across it like a stencil bridge. The band's bottom edge crops it, and
  the engine cards sit on its top edge.
- The closing band repeats it as an outline in `--field`.

### The icon

- The app icon, the favicons and the Wiki's favicon are one mark: a black (`--ink`) Archivo K on a `--field` tile, cut
  across by the same stencil bridge as the wordmark. The nav's `(K)` is text, not the icon.
- Sources: `packages/desktop/assets/icon.svg` (with `icon-16.svg` and `icon-32.svg` for the smallest sizes, which drop
  the grid and thicken the cut) and `packages/ui/public/favicon.svg`. `packages/desktop/scripts/build-icons.sh`
  renders the app's PNG and ICNS and copies the favicons into `website/public/` (`favicon.svg`, `favicon.png`,
  `apple-touch-icon.png`). Edit the sources and rerun it; don't edit the copies.
- If `--field` or `--ink` changes, change the icon's hex values with it.

## Motion

| Rule | Value | Where |
|---|---|---|
| Easing, arriving or responding | `--ease`: `cubic-bezier(0.16, 1, 0.3, 1)` | site.css |
| Easing, jumps | Cubic ease-in-out | `site.ts` |
| Press | `--fast`: 150 ms | site.css |
| Hover, focus, colour | `--base`: 220 ms | site.css |
| Reveals | `--slow`: 500 ms, staggered 80 ms per child (`--i`) | site.css, `site.ts` |
| Card steps | 450 ms rise | replay.css |
| Smooth jumps | 300–600 ms, longer for longer distances | `site.ts` |

- **Everything lasts 150–600 ms. Nothing loops.**
- **Reveals:** a block marked `data-reveal` fades in and rises 16 px, child by child, the first time it scrolls
  into view (`.in`). This applies to hero lines, cards, sections and the closing band. The hidden state exists only
  under `html.motion`. If `site.ts` doesn't run within 2.5 s, `Site.astro` drops `.motion`, so nothing stays hidden.
- **Smooth jumps:** clicks on same-page `#` links (contents, "Who makes this", Back to top) scroll in 300–600 ms.
  - They stop `scroll-padding-top` (the nav's 56 px plus 16 px) below the top, so headings never land under the nav.
  - The URL hash updates, and the target takes focus.
  - Any wheel, touch or key input stops the jump.
  - Without JS, `scroll-behavior: smooth` takes over.
  - The Wiki uses the browser's own smooth scroll (`theme.css`).
- **Reduced motion:** the head script adds `html.still`. Nothing reveals or replays, the cards show their final
  frame, jumps are instant, and every transition is 0 ms. Check this in any new code.
- **No overscroll:** `html, body { overscroll-behavior: none }`, in both site.css and theme.css. There's no
  rubber-band past the top or bottom of a page.

## Breakpoints and width

The design is checked at **1440, 900 and 430 px**. Breakpoints:

| Width | What changes |
|---|---|
| ≤ 1100 px | 3 engine cards |
| ≤ 1000 px | Numbered sections and the closing story stack; 4 column lines |
| ≤ 640 px | Phone: 2 cards, 2 column lines, 16 px gutter, a short nav. The hero's facts line moves under the buttons |

**Nothing may scroll sideways, at any width.** `overflow-x: clip` on `html` and `body` is only a safety net. The
real rule is that nothing is wider than the window: the wordmark is an SVG sized to the content, grid children use
`minmax(0, 1fr)` and `min-width: 0`, and long words in cards are cut off with an ellipsis. When you add something,
turn the safety net off in devtools and check that `document.documentElement.scrollWidth` equals the window width at
all three sizes.

## Copy

- **Bold claims live only in the hero, in the headline and subline. The line right under them must back them up
  with facts. Everywhere else: no overclaims.** Today's hero:
  - Headline: "Switch agents. Keep everything."
  - Subline (the claim): "The last agent orchestrator you'll ever need."
  - Facts: "Claude Code, Codex, pi, OpenCode and any ACP agent in one Mac app. Switch engines mid-chat and keep your
    history, extensions and settings." This line is also the meta, og and twitter description.
- **Never call Kothar "open source".** It's under FSL-1.1-ALv2, so say "source-available". The extension API is MIT.
- **No user, download or star counts** in the copy. The Star button's live count is the only exception, and it
  comes from GitHub.
- Write only what's true on `main`. Each section links to its Wiki page for the detail.
- Use Kothar's words: Kothar, space, chat, worker, extension, engine. Never "mod".
- The closing section is the builder's story, with Star and Download. It is not a repeat of the hero.
- Plain sentences. No exclamation marks or superlatives outside the hero.
