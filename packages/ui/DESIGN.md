# App design system

The look of the desktop app (`packages/ui`). It's the website's **specimen** look (`website/DESIGN.md`) carried into
a dense working tool: ink and paper, the field blue as the accent, Archivo and IBM Plex Mono, near-square corners,
hairlines rather than soft shadows, mono capital labels, and short ease-out motion.

The layout, behaviour and wording of the app are not set here; this file covers only how it looks. Every token below
names the CSS variable and the file it lives in. If you change one, change the other in the same PR.

| File | What it holds |
|---|---|
| `src/themes.tsx` | The palettes (`THEMES`: Default and Glass, dark and light) and the elevation shadows (`ELEVATION`) |
| `src/styles.css` | Fonts, type sizes, radii, motion tokens, the Tailwind token map (`@theme`), base rules, Markdown, and the `label-k`, `display` and `press` utilities |
| `src/controls.tsx` | Buttons (`BUTTON_FACE`), selects, switches, tooltips, toasts, the confirm dialog, `NAV_LABEL`, `GROUP`, and the Motion presets (`TRANSITION`, `MOTION`) |
| `src/panel-tabs.tsx` | The side panel's tabs (`TAB_CLASS`) |
| `src/sidebar.tsx` | Sidebar rows (`ROW_SELECTED`, `ROW_HOVER`) |
| `src/settings/rows.tsx` | Settings sections and rows |

## Colour

The palette is the only source of colour: components use the token utilities (`bg-panel`, `text-muted`,
`border-border`…), never hex values. Marketplace themes replace the same 13 tokens, so everything here works with
them too.

Default theme (`THEMES.default` in `themes.tsx`):

| Token | Dark (ink) | Light (paper) | Use |
|---|---|---|---|
| `--bg` | `#0e1016` (site `--ink`) | `#f4f3ee` | The chat pane and inputs |
| `--panel` | `#13161d` | `#ebeae3` (≈ site `--paper`) | Sidebar, side panel, cards, dialogs, menus |
| `--raised` | `#1b1e26` | `#e2e0d8` (site `--chip`) | User messages, inline code, the open chat's row, buttons |
| `--hover` | `#232731` | `#d9d7ce` | Hover on raised things |
| `--border` | `#2c2f38` (Wiki dark hairline) | `#cfcdc4` (Wiki light hairline) | Every hairline |
| `--text` | `#edece6` (site `--paper`) | `#0e1016` (site `--ink`) | Text |
| `--muted` | `#a9a8a2` (site `--on-ink-muted`) | `#4a4f5c` (site `--ink-muted`) | Secondary text, section kickers |
| `--faint` | `#85847e` | `#5e626c` | Placeholders, hints, group labels |
| `--accent` | `#8a9dc4` (site `--field`) | `#2563d9` (site `--blue`) | Primary buttons, focus, links, switches, the open tab and chat |
| `--on-accent` | `#0e1016` | `#ffffff` | Text on the accent |
| `--green` | `#73b07f` | `#3f7a4a` (site `--green`) | Done |
| `--amber` | `#d9a24a` | `#9a6400` (site `--amber`) | Needs you: approvals, questions, warnings |
| `--red` | `#e2685f` | `#b3362f` | Errors, Deny, Stop |

- In the dark the accent is the website's field blue with ink text on it, as on the site's hero. In the light it is
  the site's `--blue`, as in the Wiki, because the field is too light to read as text on paper.
- Glass keeps its backdrops and tints and takes the same accent.
- `themes.test.tsx` checks contrast (text 4.5:1 on every surface, muted and faint 4.5:1 in light, labels 3:1 on the
  accent) and that the accent stays far from amber. Run it after any change.

## Type

| Role | Font | Variable | Where it comes from |
|---|---|---|---|
| Everything | **Archivo** (variable weight and width) | `--sans` (styles.css), `font-sans` | `@fontsource-variable/archivo/wdth.css` |
| Code, paths, labels, main buttons, keys | **IBM Plex Mono** 400, 500, 600 | `--mono`, `font-mono` | `@fontsource/ibm-plex-mono` |

Both are SIL OFL 1.1, npm packages imported at the top of `styles.css`. Vite bundles the `.woff2` files, so the app
serves them itself. Never add a font CDN.

| Element | Style | Where |
|---|---|---|
| UI text | 13 px / 1.45 (`text-ui`) | `:root` in styles.css |
| Messages | 14 px (`text-body`) | transcript |
| Small, fine print | 12 px (`text-sm`), 11 px (`text-xs`) | |
| Label (kicker) | `label-k`: 11 px mono capitals, 600, +0.06em | sidebar group labels (`NAV_LABEL`), panel tabs, Settings section headings, Markdown table heads |
| Dialog and page titles | `display`: Archivo 800, 112% wide, capitals; 16 px in dialogs, 18 px on Settings pages | Get started, Marketplace, New space, the work folder, extension setup, Settings pages |
| Markdown headings | Archivo 800 (h1 19 px, h2 16 px), 700 below, 104% wide | `.markdown` in styles.css |
| Main buttons | `BUTTON_FACE`: 11.5 px mono capitals, 600, +0.05em | `Button` with `size="normal"`, any variant but ghost |

Small, icon and ghost buttons stay in Archivo: they sit in dense rows where capitals would crowd. Text is never
written in capitals in the source; `uppercase` does it, so screen readers and tests read the words as written.

## Shape and depth

- **Radii** (styles.css): `rounded-sm` 2 px, `rounded` 3 px, `rounded-lg` 4 px, `rounded-xl` 6 px. Switches and
  scrollbar thumbs are square too.
- **Elevation** (`ELEVATION` in themes.tsx): a hairline and a short, hard drop, like paper on a desk. Dark shadows
  are stronger and keep a 1 px top highlight (the theme test requires it). Light ones are ink at 6–34%.
- **The open chat** in the sidebar has a 2 px accent edge on its left (`ROW_SELECTED`).
- **Panel tabs** are mono capitals; the open one is underlined in the accent (like the website's nav).
- **Approval cards** keep the amber left edge on a panel barely tinted amber (`--color-permission-bg`, 4%).

## Motion

| Rule | Value | Where |
|---|---|---|
| Easing | `--ease`: `cubic-bezier(0.16, 1, 0.3, 1)`; Motion's `EASE_OUT` is the same curve | styles.css, controls.tsx |
| Press | `--fast` 150 ms | styles.css |
| Hover, colour, Motion's default | `--base` 220 ms; `TRANSITION` 0.22 s | styles.css, controls.tsx |
| Menus and tooltips | 150 ms rise of 4 px | `MOTION.menu` |

- **Buttons** (`press` utility): on hover a main button lifts 1 px with a hard 1 px line under it, like a key; on
  press it drops back and shrinks to 98%.
- **Reduced motion:** `MotionConfig reducedMotion="user"` in `main.tsx` stops Motion's animations; `press` drops its
  lift and scale; shimmer and indeterminate bars only run under `prefers-reduced-motion: no-preference`.
- **No overscroll:** `overscroll-behavior: none` on `html` and `body`.
- Nothing decorative loops. The only loops are status: the streaming caret, Working… shimmer and install bars.

## Width

The app is checked at window widths **1400, 900, 650 and 450 px**, in dark and light. Nothing may scroll sideways:
mono capitals are wider than Archivo, so anything new in `label-k` or `BUTTON_FACE` needs checking at 450 px.
