# Nexus SSH

A modern SSH terminal client for Windows and macOS, inspired by Termius, with one key difference:
**your vault is a file you own.** Hosts, credentials and keys live in an encrypted SQLCipher vault
that you can sync however you like (SFTP, FTP, S3, a shared folder), with no account or cloud service.

- Encrypted vault (master password or PIN quick-unlock)
- Vaults → groups → hosts, with credential inheritance
- Tabbed xterm.js terminal with WebGL rendering
- Dual-pane SFTP browser with drag and drop
- SSH keychain: generate, import and store keys encrypted
- Pluggable sync backends

## Download

Get the latest build from the **[downloads page](https://punterdigital.github.io/personal-apps/)** or
[GitHub Releases](https://github.com/PunterDigital/nexus-ssh/releases/latest).

Builds are unsigned. On Windows, click *More info → Run anyway* on the SmartScreen prompt. On macOS,
right-click the app → *Open* the first time.

## Development

Requires Node 24 and pnpm 10. Building the native SQLCipher module needs Visual Studio Build Tools
("Desktop development with C++") on Windows or Xcode Command Line Tools on macOS.

```bash
pnpm install       # also rebuilds @journeyapps/sqlcipher for Electron
pnpm dev           # Vite + esbuild watch + Electron
pnpm typecheck
pnpm lint
pnpm test
pnpm package       # installers into dist-release/
```

The full design is in [`ssh-client-spec.md`](ssh-client-spec.md).

## Licence

MIT © Punter Digital Limited
