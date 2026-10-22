# Nexus SSH — project notes for Claude

Electron SSH client (Termius alternative) with an encrypted SQLCipher vault. Managed under the
Personal Apps playbook (`../CLAUDE.md`). GroundStation tag: `nexus ssh`. Repo: PunterDigital/nexus-ssh.
Design doc: `ssh-client-spec.md` (read the relevant section before changing a feature).

## Stack

- Electron 44, main process bundled by esbuild (`src/main` → `dist/main`, CJS)
- Renderer: React 19 + Zustand + Tailwind 4, built by Vite (`src/renderer` → `dist/renderer`)
- `src/shared`: types and constants (incl. every IPC channel name in `IPC`)
- Native/heavy deps are esbuild externals: `ssh2`, `@journeyapps/sqlcipher`, `basic-ftp`,
  `@aws-sdk/client-s3`, `libsodium-wrappers-sumo`
- pnpm 10 (`packageManager` pinned), Node 24

## Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck     # tsc --noEmit
pnpm lint          # 0 errors required; warnings are tolerated (existing debt)
pnpm test          # vitest unit tests in tests/unit
pnpm test:e2e      # builds, then Playwright drives the real Electron app (tests/e2e)
pnpm dev           # Vite :5173 + esbuild watch + Electron (opens devtools)
pnpm exec electron-builder --win --publish never   # local installer into dist-release/
```

## Architecture notes

- Every renderer→main call goes through `window.nexus.*` (`src/main/preload.ts`) → `ipcMain.handle`
  in `src/main/ipc/*-handlers.ts`. Handlers return `{ success, data | error }`; the preload `call()`
  helper unwraps it and throws on failure. Adding an IPC call = constant in `IPC` + handler + preload
  method + (if typed) `src/renderer/types.d.ts`.
- Preload listener helpers must return `() => void` cleanups (block body), or React effect typings break.
- Production renderer is served from a loopback HTTP server (WebAuthn needs a localhost origin);
  dev loads Vite on :5173.
- Host keys (TOFU): `src/main/ssh/host-key.ts`. Every interactive connection (terminal, SFTP tabs,
  which open their own `ssh:connect`, and the host form's Test Connection) passes
  `createHostVerifier(host, port).hostVerifier` to ssh2. It must use ssh2's **callback** form
  `(key, verify)`: ssh2 passes a verifier's *return value* to `verify()`, so returning a Promise
  accepts every key (the bug fixed in #2553). Unknown/changed keys go to the renderer via
  `ssh:host-key-prompt` → `HostKeyPromptHost` (portal, above other dialogs) → `ssh:host-key-response`.
  The ssh2 `readyTimeout` (`HANDSHAKE_TIMEOUT_MS`, 60 s) includes the time the prompt is open.
- Vault sync over SFTP (`src/main/sync/backends/sftp.ts`) checks host keys too, but background
  syncs can't prompt: they use `createPinnedHostVerifier` (known_hosts only; unknown/changed key →
  clear error). Only the sync settings' Test Connection (`connect(config, { interactive: true })`)
  shows the prompt, and "Always Accept" there pins the key for later syncs.
- Sync locations: the engine passes bare file names (`<vault>.db`, `.salt`); each backend puts
  them in its folder: SFTP/FTP Remote Path (`backends/remote-dir.ts`, created on first upload),
  S3 Prefix, filesystem directory. Before v0.1.5 SFTP/FTP ignored Remote Path, so their reads
  fall back to the bare name in the login directory while the folder is empty (#2582).
- `addNotification(type, message)` (ui-store) shows a toast via `ToastHost` (portal, z-[150]:
  above dialogs, below the host-key prompt), auto-removed after 5 s. Errors are `role="alert"`,
  the rest `role="status"`, so E2E asserts them with `getByRole('alert' | 'status')`.
- App updates (`src/main/updater`, #2356): `core.ts` holds the logic (no Electron imports, unit-tested),
  `index.ts` the wiring. Modes: Windows installs (electron-updater reads `latest.yml` from GitHub
  Releases, downloads in the background, `autoInstallOnAppQuit = false`, "Restart to update" in
  `UpdateBanner` calls `quitAndInstall(true, true)`); macOS only notifies (GitHub API version check,
  "Download" opens the downloads page, since unsigned apps can't self-update); dev and test profiles
  are off. First check 5 s after launch, then every 6 h; app setting `checkForUpdates` (default on).
  electron-updater is an esbuild external loaded with a lazy `require`: a dynamic `import()` of it
  returns an undefined `autoUpdater` in the packaged app.
- **Design system (#2364): new UI MUST use it.** Read `docs/design-system.md` before building UI.
  Tokens in `src/renderer/styles/tokens.css` (Tailwind 4 `@theme`: `bg-surface-raised`,
  `text-fg-muted`, `border-line-strong`, `text-body`, `shadow-popover`, …; spacing is Tailwind's
  4 px scale). Primitives in `src/renderer/components/ui` (Button, IconButton, Field, Input,
  PasswordInput, Textarea, Select, Switch, Checkbox, RadioGroup, Card, Dialog, Tabs, Toolbar, Menu,
  EmptyState). Themes change colours only: they set
  the raw `--color-*` palette in `applyTheme()`, which also computes `--color-accent-fg` /
  `--color-danger-fg` for readable text on fills. ESLint bans hex, arbitrary values and inline
  styles in `components/ui/**`; add redesigned screen folders to that block. Gallery: URL hash
  `#design-system` (`main.tsx`), driven by `tests/e2e/design-system.spec.ts`.
- App shell (#2365): `components/shell` (AppHeader + SessionTabs, Sidebar, StatusBar, `layout.ts`
  rules). Views are switched from the sidebar nav (`<nav aria-label="Main">`); the header holds
  only session tabs (`role="tab"` in the "Open sessions" tablist; close buttons are "Close <label>"),
  Lock and Settings. Sidebar width/collapsed persist in app settings. The global `.input` class sets
  `width: 100%` (unlayered, so it beats `w-*`): size inputs with a wrapper. One terminal tab per
  host (`connectSession` reuses an open one), so E2E needing N tabs creates N hosts.
- Lock screen (#2366): `LockScreen` + `CreateVaultDialog` share `vault/LockLayout.tsx` (backdrop that
  scrolls when the window is short, card, logo, error). `Button` defaults to `secondary`: pass
  `variant="primary"` for the main action.
- PIN unlock (#2653): Settings → General → Security → "PIN unlock" (`PinUnlockControls` +
  `PinSetupDialog`) for the open vault. Main (`src/main/vault/pin-unlock.ts`, no Electron imports,
  unit-tested; `ipc/pin-handlers.ts`) wraps the vault key *and* the master password (so a sync pull
  can still reopen the vault) with an Argon2id PIN key, **in memory only**: a restart forgets every
  PIN. Wrong PINs are counted in main; the 5th (`PIN_MAX_ATTEMPTS`) drops the PIN. The lock screen
  opens on PIN when `pin:status` says enabled; "Use another method" / a lockout shows the method
  picker (PIN, Master Password unless passwordless, Hardware Key if registered). Changing the
  password, deleting the vault or a key that no longer opens the file clears the PIN; rename keeps it.
- Hosts view + forms (#2366 part 2): `ConnectionsView` (grid uses the `grid-cols-cards` utility in
  tokens.css; the list is an `@container`), each host is a button (click connects, right-click
  edits) plus a "More actions for <label>" `Menu`. `HostForm` / `GroupForm` are `ui/Dialog` forms
  that mount only while open, validate on submit (errors under the field) and save host tags.
  The one inline style is `ColourMark` (a host colour is user data). `VaultTree`, `TreeNode`,
  `TagManager` and `IdentityForm` are not imported anywhere (only re-exported) and were left as is.
  Deleting a host (#3098): "Delete host…" in the card menu and "Delete…" in the Edit host footer
  (`HostForm` `onDelete`) both open `vault/DeleteHostDialog`, which closes the host's open
  terminal/SFTP tabs (`lib/host-tabs.ts` `tabsForHost`, unit-tested; `removeTab` disconnects them)
  before `deleteHost`. E2E `host-delete.spec.ts` (uses the test SSH server for the connected case;
  xterm renders with WebGL there, so it waits on the server's connection count, not `.xterm-rows`).
- Settings, sync, keychain (#2367 part 1): `SettingsPanel` has a vertical section nav
  (`<nav aria-label="Settings sections">`, buttons with `aria-current`), `SettingRow`s in titled
  Cards, and stacks controls under labels in narrow containers (`@container`). The theme picker is a
  `radiogroup` of `ThemeCard` radios (roving tabindex); its preview sets the theme's palette as
  `--preview-*` custom properties (the one inline style: theme colours are data).
  `SyncSettingsView` auto-saves 400 ms after an edit; Push/Pull/unmount flush a pending save first.
  Keychain: `KeychainView` list + per-key Menu, delete via a Dialog.
- SFTP (#2367 part 2): `SFTPBrowser` splits two `FilePane`s with a keyboard-operable separator ("Resize
  file panes"); the split is the `--sftp-split` custom property set through a ref (no style prop).
  Each pane is an `@container` `<section>` ("Local files" / "Remote files") with a `Toolbar` and a
  multi-select `listbox` of `option`s (one Tab stop; Enter opens, Backspace goes up, F2 renames,
  Delete deletes, Shift+F10 opens the row menu, which reuses `vault/ContextMenu`). Columns hide as a
  pane narrows. Each pane loads its own first folder when the session changes. The store's `error` is
  shared by both panes, so `FilePane` reads it right after its own navigation. `BreadcrumbPath`
  scrolls its clipped nav to the end, so a long path loses its start, not the current folder.
  Transfers use a native `<progress>` with the `progress-bar` utility (tokens.css; bar = text colour:
  Chromium ignores `accent-color` on progress). Remote delete passes `isDirectory` (folders are
  deleted recursively by main). The test SSH server acknowledges SETSTAT without applying it.
- Snippets (#2367 part 2): `components/snippets` (`SnippetsPanel`, `SnippetForm`, `SnippetExecuteDialog`,
  `variables.ts` + unit tests, `useSnippetTarget`). One run dialog for the panel and the sidebar's
  "Run Snippet": built-ins ({{hostname}}, {{username}}, {{port}}) are filled from the session, every
  variable needs a value, substitution is one pass, and it only runs into a connected terminal tab.
  "Run on connect" (#2673): `terminal-store.connectSession` types those snippets once `ssh.connect`
  resolves (the shell is open), in name order, built-ins filled (`lib/snippet-auto-run.ts`, unit-tested);
  any that need a typed value are skipped and named in one warning toast. Not for SFTP tabs; a reused
  open tab doesn't rerun them, a new connection does.
- Terminal settings (#2662): `lib/terminal-options.ts` turns the vault's Settings → Terminal values
  into xterm options (validated, clamped). A module cache holds the current values: `useTerminalPrefsCache`
  (App) loads it on unlock and follows `settings:changed`, `terminal-store.reset()` clears it.
  `TerminalInstance` builds xterm from the cache (WebGL only if `gpuAcceleration`: applies to new
  sessions) and updates open terminals in place. Another view unmounts `TerminalView`; coming back
  rebuilds each xterm from the cache, and main replays the output (`markReady` → `scrollbackBuffer`).
  Main's settings `DEFAULTS` must list every vault setting: `getAll` returns only those keys
  (cursor style/blink were missing until #2662).
- External links (#2664): `window.nexus.shell.openExternal(url)` → `shell:open-external`, which opens only
  https URLs under `REPOSITORY_URL` / `DOWNLOADS_PAGE_URL` (`src/main/shell/external-links.ts`, unit-tested).
  Add a URL to that allow-list rather than a new open-anything call. The window itself never navigates.
- Secrets go to the clipboard through `window.nexus.clipboard.copySecure` (main clears it after the
  "Clipboard clear timeout"), never `navigator.clipboard`: private keys since #2663. E2E can swap main's
  `clipboard.writeText`/`readText` for an in-memory fake via `app.evaluate` (`keychain.spec.ts`),
  which keeps the shared OS clipboard out of it.
- `sr-only` is `position: absolute`: give its parent `relative`, or inside a scroll container it
  escapes to the nearest positioned ancestor outside and makes the whole page scroll (#2367).
- Icons (#2374): Lucide only (`lucide-react`), always through `<Icon icon={Terminal} size={14} />`
  (`components/common/Icon.tsx`: default 14 px, stroke 2, `aria-hidden`). No hand-drawn `<svg>` icons
  and no emoji as icons. A brand logo Lucide doesn't ship (the GitHub mark) stays an `<svg data-logo>`.
  `tests/unit/icons.test.ts` fails on any of these. The emoji a user types as a group icon is data,
  not an app icon, and stays.
- Vault management (#2646): each vault picker row has a "More actions for <name>" Menu (Rename…,
  Show in Folder, Delete…; `vault/VaultPickerDialogs.tsx`). Single-vault unlock screens reach the
  picker via "Manage vaults". Main-side logic is `src/main/vault/manage.ts` (no Electron imports,
  unit-tested): only `.db` files directly in the picker's folder, never the open vault. A vault's
  files are `<name>.db`, `<name>.db.salt`, SQLite `-journal/-wal/-shm`, plus `hwkey-store/<name>.hwkey`
  (unlock data keyed by file name): rename moves them all, delete sends
  them all to the OS trash (`shell.trashItem`). Test profiles can set `NEXUS_TRASH_DIR` to move them
  into a folder instead of the real Recycle Bin. Sync settings live inside the `.db`.
- Vault = SQLCipher DB + `.salt` file under `userData/vaults`. Keys: Argon2id (libsodium) →
  XSalsa20-Poly1305 key wrapping (`src/main/kdf`). Optional PIN and hardware-key (WebAuthn PRF) unlock.

## Testing

- **E2E env hooks** (in `src/main/index.ts`): `NEXUS_USE_BUILT_RENDERER=1` loads `dist/renderer`
  instead of Vite; `NEXUS_USER_DATA_DIR=<dir>` isolates the profile; `NEXUS_DISABLE_IDLE_LOCK=1` turns
  off idle auto-lock polling (on an unattended machine OS idle time is already past 15 min, so the
  vault would lock ~30s in). Never run E2E against the real profile — it holds Shay's vaults.
- **Update checks in tests:** a `NEXUS_USER_DATA_DIR` profile never checks for updates, so E2E of the
  packaged app never reaches GitHub. `NEXUS_UPDATE_TEST_URL=<url>` turns on notify mode against a
  local fake of the GitHub "latest release" JSON (`tests/e2e/updater.spec.ts`).
  `NEXUS_UPDATE_IN_TEST_PROFILE=1` lets a packaged build with a test profile run the real updater:
  package with `-c.extraMetadata.version=<older>` and it downloads the current release into
  `%LOCALAPPDATA%/nexus-ssh-updater` (delete it afterwards; never click "Restart to update", it
  would install over the real app). `NEXUS_DISABLE_UPDATES=1` turns everything off.
- Switching vaults (#2363): sidebar vault menu → `requestVaultSwitch()` (ui-store) → `SwitchVaultHost`
  (confirms if tabs are open) → `vault:switch` (sync-on-lock push, lock, close SSH + SFTP sessions)
  → stores reset → `showVaultPicker()`, so the lock screen opens on the picker even with one vault.
  The header Lock button (`vault:lock`) keeps sessions open; only the switch and the idle/OS lock
  close them. No command palette exists yet (`commandPaletteOpen` in ui-store is unused).
- Locking: `securityManager.lockVault()` (main) closes the vault, drops SSH + SFTP sessions and sends
  `security:vault-locked`; the renderer's `useVaultLocked` (App.tsx) resets the vault/terminal/SFTP
  stores and shows the lock screen. E2E triggers it with `app.evaluate(({ powerMonitor }) =>
  powerMonitor.emit('lock-screen'))` (`tests/e2e/auto-lock.spec.ts`).
- The smoke test creates a vault, restarts, and unlocks it. Extend `tests/e2e` for new UI flows;
  prefer `getByRole` / `getByPlaceholder` selectors.
- SSH/SFTP features need a server: use `tests/fixtures/ssh-server.ts` (`startTestServer`), a throwaway
  `ssh2` server on 127.0.0.1 with password auth, an echo shell and an SFTP subsystem backed by a temp
  dir. `writeDelayMs`/`readDelayMs` slow transfers down enough to pause them. Never hit real hosts.
  It works from vitest (`tests/unit/sftp-transfer.test.ts`, mocks `electron`) and Playwright
  (`tests/e2e/sftp-transfer.spec.ts`, drives host creation → SFTP → upload through the UI).
- Sync backends: `tests/unit/sync-backends.test.ts` round-trips the FTP and S3 backends through the
  real `basic-ftp` / `@aws-sdk/client-s3` clients against `tests/fixtures/ftp-server.ts` (passive-mode
  FTP, one user) and `tests/fixtures/s3-server.ts` (in-memory path-style S3, decodes aws-chunked
  uploads). Run it after bumping either library.

## Native module

`@journeyapps/sqlcipher` is N-API (`napi-v6`): the prebuilt binary works in Electron without a
rebuild. `scripts/postinstall.js` only falls back to `electron-rebuild` if no prebuilt binary exists.
`electron-builder` never rebuilds native modules (`npmRebuild: false`; its node-gyp breaks on current
runners). Prebuilt binaries live in per-arch folders (`lib/binding/napi-v6-<platform>-<arch>`), so the
macOS CI job also downloads the darwin-x64 binary and both Mac builds load the right one at runtime.
sqlcipher 5.3.1 still asks for `@mapbox/node-pre-gyp` 1.x (tar 6, old brace-expansion: critical/high
advisories); `pnpm-workspace.yaml` overrides it to 2.x, which keeps the same `find()` / `install` CLI.
The packaged app loads it at runtime (`lib/sqlite3-binding.js`), so test the packaged build after
touching it.

## CI / release

- `ci.yml`: ubuntu typecheck/lint/unit/build → windows + macOS E2E + package (artifacts kept 7 days).
- `release.yml`: on `v*` tag (must equal `package.json` version) builds Windows NSIS `.exe` and macOS
  `.dmg` (x64 + arm64), then creates the GitHub Release with `latest.yml` for electron-updater.
- macOS builds are ad-hoc signed by `scripts/after-pack.js` (kept from electron-builder 25, which could not ad-hoc sign itself;
  `identity: null`, hardened runtime off). CI runs `codesign --verify --deep --strict`. Windows unsigned.
- App icon (#2733): `resources/icon.svg` is the source; `scripts/make-icons.mjs` renders `icon.png` /
  `icon.ico` / `icon.icns` next to it (run it from a scratch folder with `sharp` + `png2icons`
  installed, see the script header). `win.signAndEditExecutable: true` stamps the .ico into the
  .exe (rcedit, no signing). CI checks the packaged exe + installer icon (`scripts/check-win-icon.ps1`,
  compares 32 px pixels against `resources/icon.ico`) and that each `.app` bundles `icon.icns` byte for byte.

## Known debt

See the `Audit: Nexus SSH` card in GroundStation and its follow-up cards. 54 lint warnings
(mostly `no-explicit-any`, unused vars) — fix opportunistically when touching a file.
