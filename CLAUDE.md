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
- Icons (#2374): Lucide only (`lucide-react`), always through `<Icon icon={Terminal} size={14} />`
  (`components/common/Icon.tsx`: default 14 px, stroke 2, `aria-hidden`). No hand-drawn `<svg>` icons
  and no emoji as icons. A brand logo Lucide doesn't ship (the GitHub mark) stays an `<svg data-logo>`.
  `tests/unit/icons.test.ts` fails on any of these. The emoji a user types as a group icon is data,
  not an app icon, and stays.
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

## Known debt

See the `Audit: Nexus SSH` card in GroundStation and its follow-up cards. 54 lint warnings
(mostly `no-explicit-any`, unused vars) — fix opportunistically when touching a file.
