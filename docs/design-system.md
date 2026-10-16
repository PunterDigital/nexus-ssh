# Nexus design system

Nexus is a dense desktop tool: people keep it open all day next to terminals and editors, and
read hostnames, paths and logs in it. The design system exists so every screen has the same
rhythm, type, controls and focus behaviour, and so the app stops feeling "crammed and
console-like" (#2359) without wasting space.

**Rule: new UI uses the tokens and primitives on this page.** Don't hand-roll a button, input,
dialog or menu, don't use raw hex colours, and don't use Tailwind arbitrary values
(`p-[7px]`, `text-[var(--x)]`). `components/ui/**` is lint-enforced (see [Rules](#rules)).
The existing screens move over in #2365 (app shell), #2366 (lock screen, vault picker,
connections, host forms) and #2367 (SFTP, keychain, snippets, sync, settings).

- Tokens: `src/renderer/styles/tokens.css`
- Primitives: `src/renderer/components/ui/` (import from `components/ui`)
- Icons: Lucide through `components/common/Icon.tsx` (#2374)
- Living reference: the gallery at the URL hash `#design-system`
  (dev: `pnpm dev`, then open `http://localhost:5173/#design-system`).
  `tests/e2e/design-system.spec.ts` drives it.

## Principles

1. **Themes change colours only.** A theme is a palette (`UITheme` in `src/shared/types.ts`).
   Spacing, type, radii, elevation and motion are the same in every theme, so a layout that
   works in one theme works in all of them.
2. **Semantic over literal.** Components ask for *what* a colour is for (`bg-surface-raised`,
   `text-fg-muted`, `border-line-strong`), never which colour it is. Semantic colours are
   derived from the theme palette in one place.
3. **Dense but breathable.** 13 px body text, 32 px controls, a strict 4 px grid. Density comes
   from consistent spacing, not from removing it.
4. **Keyboard first.** Every control is reachable and operable from the keyboard, with a
   visible focus ring. Composite widgets (tabs, menus, toolbars, dialogs) follow the WAI-ARIA
   Authoring Practices patterns.
5. **One way to do each thing.** One Button, one Dialog, one Menu. A new need extends a
   primitive (a variant or a prop) instead of a one-off.

## Research behind the numbers

| Topic | Guidance | What Nexus does |
|---|---|---|
| Spacing | Fluent 2 and Material 3 both use a 4 px base unit; 8 px steps for layout, 4 px for tight UI | Tailwind's spacing scale *is* the 4 px grid (`p-1` = 4 px, `p-2` = 8 px). Use multiples of 4; prefer 8 / 12 / 16 / 24 between blocks |
| Body text | macOS HIG: 13 pt body for desktop apps. Fluent 2: Body 14 px, Caption 12 px | `text-body` 13/20 as the default, 12 px for dense lists, 11 px caption only for badges and timestamps |
| Line length / height | Body line height ~1.4–1.6 for UI text | Each size carries its line height (13/20, 14/22, 16/24) |
| Contrast | WCAG 2.2 1.4.3: 4.5:1 for text (3:1 at 18 px+ or 14 px bold); 1.4.11: 3:1 for UI component boundaries and focus indicators | Text tokens map to theme text colours; `line-strong` mixes the muted text colour into control borders; on-accent / on-danger text is computed per theme (below) |
| Target size | WCAG 2.2 2.5.8: targets at least 24 × 24 px | Smallest control (`sm`) is 24 px tall; IconButton `sm` is 24 × 24 |
| Focus | WCAG 2.4.7 focus visible; 2.4.11 focus not obscured; 2.4.13 a 2 px indicator with 3:1 contrast | `focus-ring` utility: 2 px accent outline, 2 px offset, keyboard focus only (`:focus-visible`) |
| Motion | Material 3: 100–200 ms for small UI changes, 250–300 ms for larger surfaces; standard easing decelerates into place. Respect `prefers-reduced-motion` | 120 / 180 / 260 ms durations, `ease-standard`; all durations are 0 under reduced motion |
| Elevation | Fewer, clearer layers beat many shadows (Fluent 2 uses a small set of shadow ramps) | Three shadows: `raised`, `popover`, `dialog` |

Sources: [Fluent 2 layout](https://fluent2.microsoft.design/layout) and
[typography](https://fluent2.microsoft.design/typography),
[Apple HIG typography](https://developer.apple.com/design/human-interface-guidelines/typography),
[Material 3 motion](https://m3.material.io/styles/motion/easing-and-duration),
[WCAG 2.2](https://www.w3.org/TR/WCAG22/),
[WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/patterns/).

## Tokens

All tokens are CSS custom properties in `tokens.css`. The `@theme` ones are also Tailwind
utilities.

### Colour

Raw palette (set per theme by `applyTheme()`): `--color-bg-primary|secondary|tertiary`,
`--color-text-primary|secondary|muted`, `--color-accent`, `--color-border`,
`--color-danger|success|warning`. Components don't use these directly; they use:

| Token / utility | Derived from | Use for |
|---|---|---|
| `surface-sunken` | bg-secondary | sidebars, status bar, toolbars, dialog footers |
| `surface` | bg-primary | the main content area, dialogs |
| `surface-raised` | bg-tertiary | inputs, cards, menus |
| `surface-hover` / `surface-pressed` | 7% / 12% of the text colour over whatever is below | hover and pressed backgrounds of ghost controls and list rows |
| `overlay` | black 60% | dialog backdrop |
| `fg` / `fg-secondary` / `fg-muted` | text-primary / secondary / muted | body text / labels / hints, placeholders, metadata |
| `line` | border | dividers, card outlines |
| `line-strong` | 55% muted text into border | control boundaries (inputs, secondary buttons) |
| `focus` | border-focus (accent) | focus ring |
| `accent`, `accent-soft`, `on-accent` | accent, accent at 15%, computed | primary actions; selected states; text on accent fills |
| `danger`, `danger-soft`, `on-danger` | danger, 15%, computed | destructive actions and errors |
| `success(-soft)`, `warning(-soft)` | success / warning | status badges, sync state |

`on-accent` and `on-danger` are not theme colours: `applyTheme()` picks white or near-black,
whichever contrasts more with the theme's accent / danger (`readableOn()` in
`styles/contrast.ts`). White text on the accent, which the old `.btn-primary` uses, is below
3:1 on every bundled theme.

### Type

| Utility | Size / line height | Use for |
|---|---|---|
| `text-display` | 24 / 32 | lock screen, onboarding |
| `text-heading` | 20 / 28 | page titles |
| `text-heading-sm` | 16 / 24 | dialog and section titles |
| `text-body-lg` | 14 / 22 | dialog body, empty-state titles |
| `text-body` | 13 / 20 | default UI text and controls |
| `text-body-sm` | 12 / 18 | dense lists, labels, secondary text, small controls |
| `text-caption` | 11 / 16 | badges, timestamps, keyboard hints only |

Weights: 400 body, 500 (`font-medium`) controls and labels, 600 (`font-semibold`) headings.
Families: `font-ui` (Inter / system UI) and `font-code` (JetBrains Mono / Cascadia Code /
Consolas) for hostnames, paths, keys and commands. Sizes are rem, so the "UI font size"
setting scales the whole UI.

### Spacing and sizing

4 px grid via Tailwind's scale: `1` = 4 px, `2` = 8, `3` = 12, `4` = 16, `6` = 24, `8` = 32,
`12` = 48. Control heights: `sm` 24 px (`h-6`), `md` 32 px (`h-8`, default), `lg` 40 px (`h-10`).
Gaps: 4–8 px inside a control, 8–12 px between related controls, 16–24 px between groups,
32 px+ between page sections.

### Radii, elevation, motion, layers

- Radii: `rounded-sm` 4 (badges), `rounded-md` 6 (controls), `rounded-lg` 8 (cards, menus),
  `rounded-xl` 12 (dialogs), `rounded-full` (dots, avatars).
- Elevation: `shadow-raised` (cards), `shadow-popover` (menus, tooltips), `shadow-dialog`.
- Motion: `duration-(--duration-fast)` 120 ms (hover, focus), `--duration-base` 180 ms (menus,
  tabs), `--duration-slow` 260 ms (dialogs, panels); easing `ease-standard`, `ease-enter`,
  `ease-exit`. All durations are 0 with `prefers-reduced-motion`.
- Layers: `z-(--z-dropdown)` 40, `z-(--z-dialog)` 50, `z-(--z-toast)` 150,
  `z-(--z-critical)` 200 (host-key prompt).
- Focus: `focus-ring` (2 px outside) and `focus-ring-inset` (inside, for items in clipped lists).

## Primitives

Import from `components/ui`. Each one is in the gallery in every state.

| Primitive | What it's for | Notes |
|---|---|---|
| `Button` | Any text button | `variant`: `primary` (one per view: the main action), `secondary`, `ghost` (toolbars, cancel), `danger`. `size` sm/md/lg. `icon`, `iconRight`, `loading` (spinner, disabled, `aria-busy`) |
| `IconButton` | Icon-only actions | `label` is required: it's the accessible name and the tooltip. `pressed` for toggles (`aria-pressed`). Square 24/32/40 |
| `Field` | Label + control + hint/error | Wraps one control and wires `id`, `aria-describedby`, `aria-invalid`, `required` into it. `aside` for "Inherited from …" |
| `Input` | Single-line text | `leadingIcon`, `code` (monospace), `size` sm/md, `invalid` |
| `PasswordInput` | Secrets (master password, host passwords) | Input + a focusable show / hide toggle ("Show password", `aria-pressed`). `autoComplete` defaults to off |
| `Textarea` | Multi-line text (notes, commands) | Styled like Input, wired by `Field`; `code` for monospace |
| `Select` | Choosing one option | Native `<select>` styled like Input (free keyboard and screen-reader support) |
| `Switch` | An on/off setting that applies immediately | APG switch (`role="switch"`, `aria-checked`); Space / Enter toggles. Inside a `Field` the label names it, otherwise pass `label` |
| `Checkbox` | An on/off choice saved with a form (or one of several) | Native checkbox with a clickable label and optional `description` |
| `RadioGroup` | One of 2–5 options that are all worth seeing | Native radios: one tab stop, arrows move the selection. `segmented` (a row of short labels) or `list` (rows with a description). More options → `Select` |
| `Card` | A group of related content | Optional `title`, `description`, `actions`; `padding` |
| `Dialog` | Modal tasks and confirmations | Focus moves in and is trapped, Escape closes, focus returns to the opener. `footer` buttons right-aligned, primary last. `dismissOnBackdrop={false}` for forms |
| `Tabs` | Switching panels in one view | APG tabs: one tab stop, arrows / Home / End, disabled tabs skipped |
| `Toolbar` + `ToolbarSeparator` | A row of related IconButtons | `role="toolbar"`, arrow keys move between items |
| `Menu` | A list of actions behind a button | APG menu button: Enter / Space / ↓ opens on the first item, ↑ on the last; arrows, Home / End; Escape closes and refocuses the trigger. Items: `icon`, `shortcut`, `danger`, `disabled`, separators |
| `EmptyState` | A view with nothing in it | Say why it's empty and offer the next step (usually one primary Button) |

Icons inside primitives come from the `icon` props (Lucide components). Text sizes inside
controls follow the control size (sm → 12 px, md → 13 px, lg → 14 px).

### Writing patterns

- One primary button per view or dialog. Destructive confirmations: Cancel (ghost) + the
  action (danger), and the dialog title names the thing ("Delete production-web-01?").
- Labels in sentence case. Buttons say what they do ("Create Host", not "OK").
- Errors under the field say how to fix it ("Port must be between 1 and 65535").
- Hostnames, paths, keys and commands use `font-code`.

## Rules

Lint (`eslint.config.js`, files in `src/renderer/components/ui/**`) fails on:

- raw hex colours (`#7aa2f7`): use a colour token;
- Tailwind arbitrary values (`p-[7px]`, `text-[var(--x)]`, `w-[180px]`): use the scale or a
  token through the var shorthand (`z-(--z-dialog)`, `duration-(--duration-fast)`);
- inline `style` props.

Screens join this rule as they are redesigned (#2365–#2367): add their folders to the
`files` list of that ESLint block. `tests/unit/icons.test.ts` already applies to the whole
renderer (Lucide only, no emoji icons).

Adding something: if a screen needs a variant or primitive that doesn't exist, add it to
`components/ui` (with a gallery entry and, for interactive widgets, an E2E check), not a
one-off in the screen.

## App shell (#2365)

`src/renderer/components/shell/` (lint-enforced like `components/ui`):

- **Header** (`AppHeader`, 44 px): app name, the open sessions (`SessionTabs`), Lock and
  Settings. Moving between views is the sidebar's job; the header is for sessions.
- **Session tabs**: 176 px wide (112 px minimum), label truncated with the host in the
  tooltip. When they don't fit the strip scrolls sideways (mouse wheel too), scroll buttons
  and an "All sessions" menu appear, and the active tab is always scrolled into view. APG
  tabs with manual activation: one tab stop, ←/→/Home/End move focus, Enter / Space opens
  (opening a terminal moves focus into it), Delete or middle-click closes.
- **Sidebar**: vault menu, main navigation (Hosts, SFTP, Keychain, Snippets), Run Snippet,
  sync status. 176–360 px (default 224), resized by dragging its right edge or with the
  arrow keys on it (Shift = 4x, Home / End), double-click resets. It never takes so much
  that the main area drops below 560 px (`effectiveSidebarWidth` in `shell/layout.ts`).
  Collapses to a 48 px icon rail. Width and collapsed state are app settings
  (`sidebarWidth`, `sidebarCollapsed`), like the theme.
- **Main area**: `<main>` is `min-w-0 min-h-0 flex-1`, so a view shrinks instead of pushing
  the window wider. Views must fit 560 px wide: let toolbars wrap rather than squash.
- **Status bar** (24 px): active connection, session count, version.
- **Window**: minimum 900 x 600 (`WINDOW_MIN_*` in `shell/layout.ts`, checked against
  `src/main/index.ts` by a unit test). `tests/e2e/app-shell.spec.ts` visits every view at
  the minimum size and at 4K and fails on anything off-screen or cut off.

## Theme contrast audit (October 2026)

Measured with `styles/contrast.ts` against each theme's own surfaces:

| Theme | Primary text on bg | Muted text on bg / on raised | White on accent | Computed on-accent |
|---|---|---|---|---|
| Dracula | 13.6 | 4.6 / **2.9** | **2.4** | 7.8 |
| Nord | 11.2 | **2.9** / **2.4** | **2.0** | 9.4 |
| Monokai | 14.2 | 4.6 / **3.4** | **1.6** | 12.2 |
| Gruvbox | 11.6 | **3.8** / **3.0** | **2.1** | 9.2 |
| One Dark | 7.9 | **3.8** / **3.5** | **2.4** | 8.0 |
| Solarized Dark | 6.4 | **4.4** / **3.8** | **3.7** | 5.1 |
| Tokyo Night | 11.9 | 4.5 / **3.9** | **2.5** | 7.5 |

Bold = below WCAG AA 4.5:1. Primary text passes everywhere and the primitives' text on accent /
danger fills is computed, so it passes too. Muted text fails on raised surfaces (inputs, cards)
in every theme and on the base surface in four, and plain `border` is 1.2–1.6:1 (so controls
use `line-strong`). Fixing the palettes is a theme colour change: #2645.
