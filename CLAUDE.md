# Nexus SSH — project notes for Claude

Electron SSH client (Termius alternative) with an encrypted SQLCipher vault. Managed under the
Personal Apps playbook (`../CLAUDE.md`). GroundStation tag: `nexus ssh`. Repo: PunterDigital/nexus-ssh.
Design doc: `ssh-client-spec.md` (read the relevant section before changing a feature).

## Stack

- Electron 33, main process bundled by esbuild (`src/main` → `dist/main`, CJS)
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
- Vault = SQLCipher DB + `.salt` file under `userData/vaults`. Keys: Argon2id (libsodium) →
  XSalsa20-Poly1305 key wrapping (`src/main/kdf`). Optional PIN and hardware-key (WebAuthn PRF) unlock.

## Testing

- **E2E env hooks** (in `src/main/index.ts`): `NEXUS_USE_BUILT_RENDERER=1` loads `dist/renderer`
  instead of Vite; `NEXUS_USER_DATA_DIR=<dir>` isolates the profile. Never run E2E against the real
  profile — it holds Shay's vaults.
- The smoke test creates a vault, restarts, and unlocks it. Extend `tests/e2e` for new UI flows;
  prefer `getByRole` / `getByPlaceholder` selectors.
- SSH/SFTP features need a server: for E2E, spin up a throwaway one (e.g. `ssh2`'s Server class in a
  test fixture) rather than hitting real hosts.

## Native module

`@journeyapps/sqlcipher` is N-API (`napi-v6`): the prebuilt binary works in Electron without a
rebuild. `scripts/postinstall.js` only falls back to `electron-rebuild` if no prebuilt binary exists.
`electron-builder` never rebuilds native modules (`npmRebuild: false`; its node-gyp breaks on current
runners). Prebuilt binaries live in per-arch folders (`lib/binding/napi-v6-<platform>-<arch>`), so the
macOS CI job also downloads the darwin-x64 binary and both Mac builds load the right one at runtime.

## CI / release

- `ci.yml`: ubuntu typecheck/lint/unit/build → windows + macOS E2E + package (artifacts kept 7 days).
- `release.yml`: on `v*` tag (must equal `package.json` version) builds Windows NSIS `.exe` and macOS
  `.dmg` (x64 + arm64), then creates the GitHub Release with `latest.yml` for electron-updater.
- macOS builds are ad-hoc signed by `scripts/after-pack.js` (electron-builder 25 can't do ad-hoc itself;
  `identity: null`, hardened runtime off). CI runs `codesign --verify --deep --strict`. Windows unsigned.

## Known debt

See the `Audit: Nexus SSH` card in GroundStation and its follow-up cards. 54 lint warnings
(mostly `no-explicit-any`, unused vars) — fix opportunistically when touching a file.
