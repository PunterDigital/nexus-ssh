# Technical Specification: Nexus SSH Terminal Client

**Version:** 0.1.0-draft
**Author:** Shay / Punter Digital Limited
**Date:** 4 April 2026
**Status:** Draft

---

## 1. Overview

Nexus is a Windows-first SSH terminal client built on Electron, inspired by the workflow and UX patterns of Termius. It provides encrypted local storage of SSH credentials, a hierarchical vault/group/host organisation system, an integrated SFTP file browser, and a full SSH keychain manager. Unlike Termius's proprietary cloud sync, Nexus uses a **file-based encrypted vault format** that can be synced via any storage backend the user chooses - SFTP/FTP servers, S3 buckets, Google Drive, Dropbox, rsync, or any file-syncing tool.

The core principle is: **your vault is a file you own**, not a service you subscribe to.

---

## 2. Goals and Non-Goals

### 2.1 Goals

- Provide a polished, modern SSH terminal experience on Windows
- Encrypt all sensitive data at rest using a master password or PIN
- Organise connections into vaults, groups, and hosts with credential inheritance
- Offer a built-in graphical SFTP client with dual-pane layout
- Manage SSH keys (import, generate, store encrypted) via an integrated keychain
- Use a portable, file-based vault format that users can sync however they want
- Support pluggable sync backends (SFTP, FTP, S3, local filesystem) with automatic sync
- Keep the application lightweight and focused - no RDP, VNC, Telnet, or Mosh

### 2.2 Non-Goals

- Proprietary cloud sync service (the user controls their own sync backend)
- Team/shared vault collaboration (v1 is single-user; team features are a future consideration)
- Mobile clients (Windows-first; macOS/Linux via Electron are secondary targets)
- Built-in X11 forwarding server
- AI-powered autocomplete or command suggestions

---

## 3. Architecture

### 3.1 Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Shell | Electron (latest stable) | Cross-platform window management, native menu integration, tray support |
| Renderer | React + TypeScript | Component-driven UI, strong typing, large ecosystem |
| Styling | Tailwind CSS | Rapid UI development, consistent design tokens, theme support |
| Terminal emulation | xterm.js | Industry-standard terminal emulator for web, GPU-accelerated rendering via WebGL addon |
| SSH protocol | ssh2 (npm) | Pure JS SSH2 client, no native dependencies, supports all modern ciphers and key exchange |
| SFTP protocol | ssh2 SFTP subsystem | Comes bundled with ssh2, provides full SFTP channel support |
| Database | @journeyapps/sqlcipher (SQLCipher) | SQLite with transparent AES-256-CBC page-level encryption, HMAC-SHA512 authentication, single-file vault |
| Key derivation | libsodium.js (libsodium-wrappers) | Argon2id for master password → database key derivation (memory-hard, GPU-resistant) |
| Key generation | ssh-keygen via Node child_process + ssh2-utils | Leverage OpenSSH's ssh-keygen for RSA/Ed25519/ECDSA generation |
| Sync engine | Custom sync module with pluggable backends | Abstract interface with SFTP, FTP, S3, and filesystem implementations |
| IPC | Electron contextBridge + ipcMain/ipcRenderer | Secure communication between renderer and main process |

### 3.2 Process Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Main Process                          │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐             │
│  │  Vault   │  │   SSH    │  │   Sync    │             │
│  │  Engine  │  │  Manager │  │  Engine   │             │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘             │
│       │              │              │                    │
│  ┌────┴─────┐  ┌────┴─────┐  ┌─────┴─────┐             │
│  │ SQLCipher│  │  ssh2    │  │  Backend  │             │
│  │  + KDF   │  │  Client  │  │  Plugins  │             │
│  └──────────┘  └──────────┘  └───────────┘             │
│                                                          │
│  ┌──────────────────────────────────────────┐           │
│  │       SQLCipher (encrypted vault file)    │           │
│  └──────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────┘
        │ IPC (contextBridge)
┌─────────────────────────────────────────────────────────┐
│                  Renderer Process                        │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐             │
│  │ Terminal  │  │  SFTP    │  │  Vault    │             │
│  │  Tabs    │  │  Browser │  │  Manager  │             │
│  └──────────┘  └──────────┘  └───────────┘             │
│                                                          │
│  ┌──────────────────────────────────────────┐           │
│  │         xterm.js (WebGL renderer)         │           │
│  └──────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────┘
```

All SSH connections, key derivation, file I/O, and sync operations run in the **main process** (or a spawned worker thread for the Argon2id key derivation step). The renderer process handles UI only and communicates via a tightly scoped IPC API exposed through `contextBridge`. No `nodeIntegration` in the renderer - all Node access goes through the preload script.

### 3.3 Directory Structure

```
nexus/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # App entry point, window management
│   │   ├── ipc/                 # IPC handler registrations
│   │   ├── vault/               # Vault engine (open, lock, CRUD, SQLCipher)
│   │   ├── kdf/                 # Argon2id key derivation, PIN unlock
│   │   ├── ssh/                 # SSH connection manager, session pool
│   │   ├── sftp/                # SFTP operations bridge
│   │   ├── keychain/            # SSH key import, generation, storage
│   │   ├── sync/                # Sync engine + backend plugins
│   │   │   ├── engine.ts        # Conflict resolution, sync orchestration
│   │   │   ├── backends/
│   │   │   │   ├── sftp.ts
│   │   │   │   ├── ftp.ts
│   │   │   │   ├── s3.ts
│   │   │   │   └── filesystem.ts
│   │   │   └── types.ts         # SyncBackend interface
│   │   └── preload.ts           # contextBridge API exposure
│   ├── renderer/                # React application
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── terminal/        # Terminal tabs
│   │   │   ├── sftp/            # Dual-pane file browser
│   │   │   ├── vault/           # Vault tree, host/group CRUD
│   │   │   ├── keychain/        # Key list, import/generate dialogs
│   │   │   ├── sync/            # Sync status, backend configuration
│   │   │   └── common/          # Shared UI components
│   │   ├── hooks/               # React hooks for IPC calls
│   │   ├── stores/              # Zustand state management
│   │   └── styles/              # Tailwind config, theme tokens
│   └── shared/                  # Types shared between main/renderer
│       ├── types.ts
│       └── constants.ts
├── resources/                   # Icons, platform assets
├── electron-builder.yml         # Build/packaging config
├── package.json
├── tsconfig.json
└── tailwind.config.js
```

---

## 4. Encryption and Vault System

### 4.1 Vault File Format

The vault is a **single SQLCipher database file** (e.g. `nexus-vault.db`) that can be freely copied, backed up, and synced. SQLCipher is a widely-used open-source fork of SQLite that provides **transparent, full-database AES-256-CBC encryption** with HMAC-SHA512 page authentication. Every page written to disk is encrypted - there is no plaintext anywhere in the file. Applications like Signal, 1Password (historically), and Zetetic's own products rely on SQLCipher for at-rest encryption.

From the application's perspective, interacting with an open SQLCipher database is identical to using a normal SQLite database. All encryption and decryption happens transparently at the page level. There is no need for field-level encryption, nonce management, or custom encrypt/decrypt pipelines in application code.

Vault file location defaults:
- **Windows:** `%APPDATA%/Nexus/vaults/`
- **macOS:** `~/Library/Application Support/Nexus/vaults/`
- **Linux:** `~/.config/nexus/vaults/`

Users can create multiple vault files and open them independently (e.g. one for personal servers, one for work).

### 4.2 Encryption Scheme

SQLCipher handles the actual encryption. The only custom cryptographic code in Nexus is the **key derivation** step, where we use Argon2id (via libsodium.js) instead of SQLCipher's built-in PBKDF2-SHA512 to derive the database key from the user's master password. Argon2id is memory-hard, making it significantly more resistant to GPU and ASIC-based brute force attacks than PBKDF2.

**Master password unlock flow:**

```
User enters master password
        │
        ▼
┌──────────────────────────────────┐
│  Argon2id key derivation          │
│  (libsodium crypto_pwhash)        │
│                                   │
│  - Salt: 16 bytes, randomly       │
│    generated on vault creation,   │
│    stored in a sidecar file       │
│    (nexus-vault.salt)             │
│  - OpsLimit: 3 (moderate)         │
│  - MemLimit: 256 MiB              │
│  - Output: 32-byte raw key        │
└───────────────┬──────────────────┘
                │
                ▼
┌──────────────────────────────────┐
│  Open SQLCipher database          │
│                                   │
│  PRAGMA key = "x'<hex_key>'";     │
│  PRAGMA cipher_page_size = 4096;  │
│  PRAGMA kdf_iter = 0;             │
│  (we skip SQLCipher's internal    │
│   KDF since we did our own)       │
└───────────────┬──────────────────┘
                │
                ▼
┌──────────────────────────────────┐
│  Verify by running a test query   │
│  SELECT count(*) FROM hosts;      │
│                                   │
│  - Success → vault unlocked       │
│  - SQLITE_NOTADB → wrong password │
└──────────────────────────────────┘
                │
                ▼
     Database is open.
     Read and write normally.
     SQLCipher encrypts every page
     transparently on disk.
```

**What SQLCipher provides under the hood (no application code needed):**

- AES-256-CBC encryption of every database page
- HMAC-SHA512 authentication per page (tamper detection)
- Unique IV per page derived from page number and a random salt
- Automatic re-encryption on every write
- Full database is opaque binary when locked - no metadata leakage

**Sidecar salt file:** The Argon2id salt is stored in a separate small file (`nexus-vault.salt`, 16 bytes base64-encoded) alongside the vault database. This file is not sensitive - it's just a random value that prevents rainbow table attacks. It needs to be synced alongside the vault file. The sync engine handles this automatically by treating the vault as a two-file pair (`.db` + `.salt`).

### 4.3 PIN Unlock (Quick Unlock)

After initial master password entry, users can optionally set a 4-8 digit PIN for faster re-unlock within the same session or after screen lock:

1. On first unlock with master password, the 32-byte derived database key is held in memory
2. Generate a random 32-byte **wrapping key**
3. Encrypt the database key with the wrapping key using libsodium's `crypto_secretbox` (XSalsa20-Poly1305)
4. Derive a **PIN key** from the user's PIN via Argon2id with lighter parameters (OpsLimit 1, MemLimit 64 MiB)
5. Encrypt the wrapping key with the PIN key
6. Store the PIN-encrypted wrapping key in the OS credential store (Windows Credential Manager via `keytar`)
7. On PIN entry: derive PIN key → decrypt wrapping key → decrypt database key → open SQLCipher
8. After 3 failed PIN attempts, require the full master password
9. PIN-encrypted material is wiped on app quit (configurable to persist across restarts)

The PIN flow is the only place where libsodium's secretbox is used directly. Everything else goes through SQLCipher.

### 4.4 Vault Database Schema

Since SQLCipher encrypts the entire database transparently, all fields are stored as **plaintext SQL** - no `_enc` suffixes, no base64 nonces, no field-level encryption logic. Passwords and private keys are written as normal text columns. The security comes from the entire file being encrypted on disk.

```sql
-- Application metadata
CREATE TABLE app_meta (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
);
-- Stores: schema_version, created_at, updated_at, argon2_ops_limit, argon2_mem_limit
-- (Argon2id params are fixed at OpsLimit 3 / MemLimit 256 MiB but stored here
--  so future versions can detect and migrate if defaults change)

-- Top-level vault containers (organisational grouping)
CREATE TABLE vaults (
    id          TEXT PRIMARY KEY,        -- UUIDv4
    name        TEXT NOT NULL,
    description TEXT,
    icon        TEXT,                    -- Emoji or icon identifier
    sort_order  INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- Groups within vaults (nested via parent_id)
CREATE TABLE groups (
    id                  TEXT PRIMARY KEY,
    vault_id            TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    parent_id           TEXT REFERENCES groups(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    description         TEXT,
    icon                TEXT,
    sort_order          INTEGER DEFAULT 0,
    -- Inheritable defaults
    default_port        INTEGER,
    default_username    TEXT,
    default_identity_id TEXT REFERENCES identities(id),
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

-- Individual host entries
CREATE TABLE hosts (
    id                  TEXT PRIMARY KEY,
    vault_id            TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    group_id            TEXT REFERENCES groups(id) ON DELETE SET NULL,
    label               TEXT NOT NULL,       -- Human-friendly display name
    hostname            TEXT NOT NULL,       -- IP or domain
    port                INTEGER DEFAULT 22,
    username            TEXT,
    password            TEXT,                -- Plaintext in DB, encrypted on disk by SQLCipher
    identity_id         TEXT REFERENCES identities(id),
    -- Connection settings
    keepalive_interval  INTEGER DEFAULT 60,
    compression         INTEGER DEFAULT 0,
    -- Metadata
    os_type             TEXT,                -- linux, windows, macos, freebsd, etc.
    notes               TEXT,
    colour              TEXT,                -- Hex colour for tab identification
    sort_order          INTEGER DEFAULT 0,
    last_connected      TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

-- Tags (many-to-many with hosts)
CREATE TABLE tags (
    id      TEXT PRIMARY KEY,
    name    TEXT NOT NULL UNIQUE,
    colour  TEXT
);

CREATE TABLE host_tags (
    host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (host_id, tag_id)
);

-- Reusable credential bundles
CREATE TABLE identities (
    id          TEXT PRIMARY KEY,
    vault_id    TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    username    TEXT,
    password    TEXT,
    key_id      TEXT REFERENCES ssh_keys(id),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- SSH key storage
CREATE TABLE ssh_keys (
    id          TEXT PRIMARY KEY,
    vault_id    TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    key_type    TEXT NOT NULL,            -- rsa, ed25519, ecdsa
    bits        INTEGER,                 -- 2048, 4096, etc. (RSA only)
    fingerprint TEXT NOT NULL,           -- SHA256 fingerprint
    public_key  TEXT NOT NULL,           -- Public key (OpenSSH format)
    private_key TEXT NOT NULL,           -- Private key PEM
    passphrase  TEXT,                    -- Key passphrase (if applicable)
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- Known hosts (TOFU verification)
CREATE TABLE known_hosts (
    id          TEXT PRIMARY KEY,
    hostname    TEXT NOT NULL,
    port        INTEGER NOT NULL DEFAULT 22,
    key_type    TEXT NOT NULL,
    public_key  TEXT NOT NULL,
    first_seen  TEXT NOT NULL,
    last_seen   TEXT NOT NULL,
    trusted     INTEGER DEFAULT 1,
    UNIQUE(hostname, port, key_type)
);

-- Snippets (saved commands)
CREATE TABLE snippets (
    id              TEXT PRIMARY KEY,
    vault_id        TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    command         TEXT NOT NULL,
    description     TEXT,
    run_on_connect  INTEGER DEFAULT 0,
    sort_order      INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

-- Sync backend configuration
CREATE TABLE sync_state (
    id              TEXT PRIMARY KEY,
    backend_type    TEXT NOT NULL,        -- sftp, ftp, s3, filesystem
    backend_config  TEXT NOT NULL,        -- JSON config (encrypted on disk by SQLCipher)
    last_sync_at    TEXT,
    last_sync_hash  TEXT,                 -- SHA256 of vault file at last sync
    sync_interval   INTEGER DEFAULT 300,  -- Seconds between auto-syncs
    enabled         INTEGER DEFAULT 1,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

```

### 4.5 Security Considerations

- The derived database key is held in a Node.js `Buffer` in the main process and **zeroed on vault lock** using `buffer.fill(0)`
- Auto-lock after configurable idle timeout (default: 15 minutes)
- Auto-lock on system sleep/screen lock (via Electron `powerMonitor`)
- Clipboard containing passwords is auto-cleared after 30 seconds
- No sensitive data is ever written to Electron's localStorage, cookies, or session storage
- Renderer process has no direct access to the database key or SQLCipher handle - all data access goes through IPC
- CSP headers prevent inline scripts and remote resource loading in the renderer
- The entire vault file is opaque when locked - no hostnames, labels, or structure is visible without the master password
- SQLCipher's HMAC-SHA512 page authentication detects any tampering or corruption of the vault file

---

## 5. Vault Organisation

### 5.1 Hierarchy Model

```
Vault (e.g. "Work Servers")
├── Group: "AWS EU-West"
│   ├── Group: "Production"
│   │   ├── Host: web-prod-01
│   │   ├── Host: web-prod-02
│   │   └── Host: db-prod-01
│   └── Group: "Staging"
│       ├── Host: web-staging-01
│       └── Host: db-staging-01
├── Group: "Hetzner"
│   ├── Host: monitor-01
│   └── Host: backup-01
└── Ungrouped
    └── Host: personal-vps

Vault (e.g. "Client - NHS Trust A")
├── Group: "CDS Servers"
│   ├── Host: cds-prod
│   └── Host: cds-uat
└── Group: "Refer Servers"
    └── Host: refer-prod
```

### 5.2 Credential Inheritance

Credential resolution follows a **bottom-up chain** from host to parent group to grandparent group, stopping at the first defined value:

```
resolve_credential(host, field):
    if host[field] is set:
        return host[field]
    group = host.group
    while group is not null:
        if group[default_{field}] is set:
            return group[default_{field}]
        group = group.parent
    return null
```

Inheritable fields: `username`, `port`, `identity_id`. The UI shows inherited values in a visually distinct style (e.g. dimmed text with an "inherited from [Group Name]" tooltip) so users always know where a value comes from.

### 5.3 Multi-Vault Support

Users can have multiple vault files open simultaneously. Each vault has its own master password and its own SQLCipher encryption key. The app sidebar shows a collapsible tree per vault. Use cases:

- Separate vaults for personal / work / client projects
- Share a vault file with a colleague by giving them the file + password (basic sharing without team features)

---

## 6. SSH Terminal

### 6.1 Connection Lifecycle

```
User clicks host → resolve credentials (inheritance chain)
    │
    ├── Authentication attempts (in order):
    │   1. Identity SSH key (if linked)
    │   2. Identity password (if linked)
    │   3. Host-specific password (if set)
    │   4. Interactive keyboard prompt (fallback)
    │
    ├── Host key verification against known_hosts table
    │   ├── Known + matching → proceed
    │   ├── Unknown → TOFU prompt (accept/reject/always)
    │   └── Changed → WARNING dialog (possible MITM)
    │
    └── Open PTY → attach xterm.js → session active
```

### 6.2 Terminal Features

- **Tabs:** Browser-style horizontal tabs, drag-to-reorder, middle-click to close, tab colour matching host colour setting
- **Scrollback:** Configurable buffer size, default 10,000 lines

### 6.3 Terminal Emulation (xterm.js)

- **TERM type:** `xterm-256color`
- **Addons loaded:** WebGL renderer, fit, web links, Unicode 11, image (sixel/iTerm2 inline images)
- **Font:** User-configurable, default JetBrains Mono, with Nerd Font variants bundled
- **Themes:** Ship with a curated set (Dracula, Nord, Monokai, Gruvbox, One Dark, Solarized, Tokyo Night) plus a custom theme editor (foreground, background, cursor, selection, ANSI colour palette)
- **Ligatures:** Supported via the ligatures addon when using compatible fonts
- **GPU acceleration:** WebGL renderer enabled by default with automatic fallback to canvas

---

## 7. SFTP File Browser

### 7.1 Layout

The SFTP browser opens in its own tab type (separate from terminal tabs) and uses a **dual-pane layout** with local files always on the left and the remote server always on the right:

```
┌─────────────────────────────────────────────────────────┐
│  Local: C:\Users\shay\Downloads     [⚙]  [⟲]          │
│  Remote: /home/deploy/app/                              │
├────────────────────────┬────────────────────────────────┤
│   Local Pane           │   Remote Pane                  │
│                        │                                │
│  📁 Documents/         │  📁 config/                    │
│  📁 Downloads/         │  📁 logs/                      │
│  📄 deploy.sh   1.1KB  │  📄 app.js           4.2KB    │
│  📄 config.json 2.4KB  │  📄 .env             0.3KB    │
│                        │  📄 package.json     1.8KB    │
│                        │                                │
├────────────────────────┴────────────────────────────────┤
│  Transfers: ██████████░░░░ config.json (67%) 2.1MB/s    │
│  Queue: 3 files remaining                               │
└─────────────────────────────────────────────────────────┘
```

### 7.2 Features

- **Navigation:** Breadcrumb path bar with click-to-navigate, back/forward history, parent directory button, manual path entry
- **File operations:** Upload, download, rename, delete, create directory, move (drag between panes), copy path to clipboard
- **Transfer management:** Queue with progress bars, pause/resume individual transfers, retry failed transfers, cancel, concurrent transfer limit (configurable, default 3)
- **Drag and drop:** Between panes (local ↔ remote), from OS file explorer into the local pane
- **Permissions:** Display Unix permissions in the file list columns, right-click to chmod via a dialog with octal input and checkbox toggles
- **Sorting:** By name, size, date modified, type - click column headers
- **Hidden files:** Toggle visibility of dotfiles

### 7.3 SFTP Connection

SFTP sessions reuse the SSH connection established for the host. If the user opens SFTP from a connected terminal tab, the existing connection's SFTP subsystem is used. If opened independently, a new SSH connection is established using the same credential resolution chain.

---

## 8. Keychain Manager

### 8.1 Key Storage

All private keys are stored in the `ssh_keys` table as plaintext columns - SQLCipher encrypts them transparently on disk along with everything else in the vault. The keychain UI shows:

- Key name (user-defined label)
- Key type and size (e.g. "Ed25519", "RSA 4096-bit")
- SHA256 fingerprint
- Which identities/hosts reference this key
- Created date
- Public key (copyable with one click)

### 8.2 Key Generation

Users can generate new SSH keys from within the app:

| Key Type | Options |
|---|---|
| RSA | 2048, 3072, 4096 bit |
| Ed25519 | (no size options, fixed 256-bit) |
| ECDSA | 256, 384, 521 bit curves |

Generation process:

1. User selects key type, bit size, and optional passphrase
2. Main process spawns `ssh-keygen` via `child_process.execFile` with appropriate flags (`-t`, `-b`, `-f`, `-N`, `-C`)
3. Output is written to a temp directory, read into memory, then the temp files are securely deleted
4. Private key is stored in `ssh_keys` (encrypted on disk by SQLCipher)
5. Public key is stored in plaintext in `ssh_keys`
6. User is prompted to copy the public key to clipboard for adding to servers

### 8.3 Key Import

Supported import methods:

- **File picker:** Select a private key file from disk (PEM or OpenSSH format)
- **Clipboard paste:** Paste a private key directly

Supported formats:
- OpenSSH format (`-----BEGIN OPENSSH PRIVATE KEY-----`)
- PEM/PKCS#8 format (`-----BEGIN RSA PRIVATE KEY-----`, `-----BEGIN EC PRIVATE KEY-----`, etc.)
- **PPK (PuTTY):** Automatically converted on import using a JS PPK parser (since PuTTY is still widely used on Windows)

Passphrase-protected keys are detected automatically - the user is prompted for the passphrase during import. The passphrase is stored encrypted alongside the key so the user doesn't need to re-enter it on every connection (with an option to require re-entry each time for higher security).

---

## 9. Sync Engine

### 9.1 Design Principles

The sync engine treats the vault file as an opaque encrypted blob from the backend's perspective. Sync backends don't need to understand the vault format - they just move files.

```
┌──────────┐     ┌──────────────┐     ┌───────────────┐
│  Local    │────▶│  Sync Engine │────▶│  Remote       │
│  Vault    │◀────│  (main proc) │◀────│  Backend      │
│  .db file │     │              │     │  (S3/SFTP/etc)│
└──────────┘     └──────────────┘     └───────────────┘
```

### 9.2 Sync Backend Interface

```typescript
interface SyncBackend {
    // Lifecycle
    connect(config: BackendConfig): Promise<void>;
    disconnect(): Promise<void>;
    testConnection(): Promise<boolean>;

    // Operations
    upload(localPath: string, remotePath: string): Promise<void>;
    download(remotePath: string, localPath: string): Promise<void>;
    getRemoteMetadata(remotePath: string): Promise<FileMetadata | null>;

    // Info
    readonly type: 'sftp' | 'ftp' | 's3' | 'filesystem' | 'webdav';
    readonly displayName: string;
}

interface BackendConfig {
    type: string;
    // SFTP/FTP
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    privateKeyId?: string;  // Reference to a vault SSH key
    remotePath?: string;    // e.g. /backups/nexus/
    // S3
    bucket?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    prefix?: string;        // e.g. nexus-vaults/
    endpoint?: string;      // For S3-compatible (MinIO, Backblaze B2, etc.)
    // Filesystem
    directoryPath?: string; // e.g. a Dropbox/Google Drive/OneDrive synced folder
}

interface FileMetadata {
    size: number;
    lastModified: Date;
    etag?: string;          // S3 ETags, used for conflict detection
    hash?: string;          // SHA256 of remote file
}
```

### 9.3 Sync Flow

The sync engine treats each vault as a **two-file pair**: the SQLCipher database (`.db`) and the Argon2id salt sidecar (`.salt`). Both files are always synced together.

```
Auto-sync timer fires (every N seconds) OR user triggers manual sync
    │
    ├── Calculate SHA256 of local vault .db file
    │
    ├── Compare with last_sync_hash in sync_state table
    │   ├── No local changes AND no remote changes → skip
    │   ├── Local changes only → upload .db + .salt
    │   ├── Remote changes only → download .db + .salt, re-open vault
    │   └── Both changed → CONFLICT
    │
    ├── On CONFLICT:
    │   ├── Notify user with dialog
    │   ├── Options:
    │   │   ├── Keep local (upload, overwrite remote)
    │   │   ├── Keep remote (download, overwrite local)
    │   │   └── Keep both (save remote as .db.conflict.{timestamp})
    │   └── User decides
    │
    └── Update last_sync_hash and last_sync_at
```

### 9.4 Bundled Backends

**SFTP Backend:** Uses the same `ssh2` library as the terminal connections. Supports password and key-based auth. The sync backend can reuse vault SSH keys for authentication, meaning your SFTP backup server credentials can live inside the vault itself (bootstrapped on first setup).

**FTP Backend:** Uses `basic-ftp` npm package. Supports FTP and FTPS (explicit TLS). Not recommended for security-sensitive deployments but included for environments where SFTP isn't available.

**S3 Backend:** Uses `@aws-sdk/client-s3`. Supports AWS S3, MinIO, Backblaze B2, DigitalOcean Spaces, Cloudflare R2, and any S3-compatible endpoint. Versioning-aware: if the bucket has versioning enabled, the sync engine can list previous versions for point-in-time recovery.

**Filesystem Backend:** Simply copies the vault file to a local directory path. Designed to work with third-party sync tools - point it at a Dropbox, Google Drive, OneDrive, Syncthing, or Nextcloud sync folder and let those tools handle the transport. Simplest option with zero configuration beyond a folder path.

### 9.5 Sync Settings UI

Per-vault sync configuration:

- Backend selection (dropdown with setup wizard per type)
- Connection test button
- Sync interval (1 min / 5 min / 15 min / 30 min / manual only)
- Sync on vault lock (push changes when locking the vault)
- Sync on app launch (pull latest on startup before unlocking)
- Conflict resolution default (ask / always keep local / always keep remote)
- Sync history log (timestamps, outcomes, errors)

---

## 10. User Interface

### 10.1 Application Layout

```
┌──────────────────────────────────────────────────────────┐
│  [Nexus]  [Terminal▾] [SFTP▾] [+ New Tab]    [🔒] [⚙]  │
│  ┌─tab1─┐ ┌─tab2─┐ ┌─tab3─┐                            │
├──────────────────────────────────────────────────────────┤
│ ┌──────────┐                                             │
│ │ Sidebar  │  Main Content Area                          │
│ │          │  (Terminal / SFTP / Settings / Keychain)     │
│ │ Vaults   │                                             │
│ │ ├ Work   │                                             │
│ │ │ ├ AWS  │                                             │
│ │ │ │ ├ h1 │                                             │
│ │ │ │ └ h2 │                                             │
│ │ │ └ HZ   │                                             │
│ │ └ Client │                                             │
│ │          │                                             │
│ │ Keychain │                                             │
│ │ Snippets │                                             │
│ │ Sync ◉   │                                             │
│ └──────────┘                                             │
├──────────────────────────────────────────────────────────┤
│  Status: Connected to web-prod-01 | Sync: ✓ 2min ago    │
└──────────────────────────────────────────────────────────┘
```

### 10.2 Key UI Flows

**First launch:** Welcome screen → Create vault (name + master password with strength meter) → Optional: configure sync backend → Main app

**Unlock:** App opens to lock screen with vault file selector + password/PIN entry. Since the vault is fully encrypted (opaque when locked), no vault contents are displayed until the master password is entered. If sync-on-launch is enabled, the latest vault file is pulled before prompting for the password.

**Connect to host:** Double-click host in sidebar. New terminal tab opens with connection progress indicator.

**Quick connect:** Click the "+" button in the tab bar → enter `user@host:port` → Connect. Creates a temporary (unsaved) connection.

**Add host:** Right-click group → "New Host" → Form with: label, hostname, port, authentication (password / identity / key), group, tags, colour, notes. Test connection button before saving.

### 10.3 Theming

The theme engine uses CSS custom properties mapped to Tailwind's configuration. Terminal themes (xterm.js) and UI themes are configured separately but ship as coordinated pairs. The custom theme editor exposes:

- Background (primary, secondary, tertiary surfaces)
- Text (primary, secondary, muted)
- Accent colour
- Terminal palette (16 ANSI colours + foreground + background + cursor + selection)
- Font family and size (separate for UI and terminal)

Themes are stored in the vault file so they sync with the rest of the configuration.

---

## 11. Snippets

Snippets are saved command templates that can be executed in any active terminal session:

- **Name and description** for organisation
- **Command text** supporting multi-line commands
- **Variable interpolation:** `{{hostname}}`, `{{username}}`, `{{port}}`, `{{custom:label}}` (prompts user for input)
- **Run on connect:** Optionally execute automatically when connecting to associated hosts
- **Vault-scoped:** Snippets belong to a vault and are available to all hosts in that vault
- **Execution:** Click from sidebar or right-click in terminal → "Run Snippet"

---

## 12. Build and Packaging

### 12.1 Electron Builder Configuration

- **Target:** Windows (NSIS installer), with macOS (DMG) and Linux (AppImage, deb) as secondary targets
- **Auto-update:** electron-updater with GitHub Releases as the update feed
- **Code signing:** Windows Authenticode signing via CI/CD pipeline
- **Installer options:** Per-user install (no admin required)

### 12.2 Development Workflow

- **Package manager:** pnpm (faster, stricter than npm)
- **Bundler:** Vite for the renderer process, esbuild for the main process
- **Linting:** ESLint + Prettier with strict TypeScript rules
- **Testing:** Vitest for unit tests, Playwright for E2E UI testing
- **CI/CD:** GitHub Actions with build/test/release pipeline

---

## 13. Performance Targets

| Metric | Target |
|---|---|
| App cold start to lock screen | < 2 seconds |
| Vault unlock (Argon2id derivation) | < 3 seconds on modern hardware |
| SSH connection establishment | < 2 seconds (excluding network latency) |
| Terminal input latency | < 16ms (single frame at 60fps) |
| SFTP directory listing (1000 files) | < 1 second |
| Memory usage (5 terminal tabs) | < 500 MB |
| Vault file size (500 hosts) | < 5 MB |


