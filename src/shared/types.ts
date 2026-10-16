// ============================================================
// Nexus SSH Client — Shared Type Definitions
// ============================================================

// --- Enums ---

export type KeyType = 'rsa' | 'ed25519' | 'ecdsa';

export type OSType = 'linux' | 'windows' | 'macos' | 'freebsd' | 'other';

export type SyncBackendType = 'sftp' | 'ftp' | 's3' | 'filesystem' | 'webdav';

export type ConflictResolution = 'ask' | 'keep_local' | 'keep_remote';

export type SyncInterval = 60 | 300 | 900 | 1800 | 0; // 0 = manual only

// --- Vault Schema Types ---

export interface AppMeta {
  key: string;
  value: string;
}

export interface Vault {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Group {
  id: string;
  vault_id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  default_port: number | null;
  default_username: string | null;
  default_identity_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Host {
  id: string;
  vault_id: string;
  group_id: string | null;
  label: string;
  hostname: string;
  port: number;
  username: string | null;
  password: string | null;
  identity_id: string | null;
  key_id: string | null;
  keepalive_interval: number;
  compression: boolean;
  os_type: OSType | null;
  notes: string | null;
  colour: string | null;
  sort_order: number;
  last_connected: string | null;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  name: string;
  colour: string | null;
}

export interface HostTag {
  host_id: string;
  tag_id: string;
}

export interface Identity {
  id: string;
  vault_id: string;
  name: string;
  username: string | null;
  password: string | null;
  key_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SSHKey {
  id: string;
  vault_id: string;
  name: string;
  key_type: KeyType;
  bits: number | null;
  fingerprint: string;
  public_key: string;
  private_key: string;
  passphrase: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnownHost {
  id: string;
  hostname: string;
  port: number;
  key_type: string;
  public_key: string;
  first_seen: string;
  last_seen: string;
  trusted: boolean;
}

export interface Snippet {
  id: string;
  vault_id: string;
  name: string;
  command: string;
  description: string | null;
  run_on_connect: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SyncState {
  id: string;
  backend_type: SyncBackendType;
  backend_config: string; // JSON string
  last_sync_at: string | null;
  last_sync_hash: string | null;
  sync_interval: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// --- Sync Backend Types ---

export interface BackendConfig {
  type: SyncBackendType;
  // SFTP / FTP
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKeyId?: string;
  remotePath?: string;
  // S3
  bucket?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  prefix?: string;
  endpoint?: string;
  // Filesystem
  directoryPath?: string;
}

export interface FileMetadata {
  size: number;
  lastModified: Date;
  etag?: string;
  hash?: string;
}

export interface SyncConnectOptions {
  /** A user is waiting (Test Connection): unknown/changed SSH host keys may be prompted for. */
  interactive?: boolean;
}

export interface SyncBackend {
  connect(config: BackendConfig, options?: SyncConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<boolean>;
  upload(localPath: string, remotePath: string): Promise<void>;
  download(remotePath: string, localPath: string): Promise<void>;
  getRemoteMetadata(remotePath: string): Promise<FileMetadata | null>;
  readonly type: SyncBackendType;
  readonly displayName: string;
}

// --- SSH / Terminal Types ---

export interface ResolvedCredentials {
  hostname: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export type SSHSessionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface SSHSession {
  id: string;
  hostId: string;
  label: string;
  colour: string | null;
  connected: boolean;
  status: SSHSessionStatus;
  hostname?: string;
  error?: string | null;
  startedAt: string;
}

export type HostKeyVerification = 'accept' | 'reject' | 'always';

export interface HostKeyPrompt {
  /** Identifies the pending prompt when the renderer answers. */
  id: string;
  hostname: string;
  port: number;
  keyType: string;
  fingerprint: string;
  status: 'new' | 'changed';
}

// --- SFTP Types ---

export interface SFTPEntry {
  filename: string;
  longname: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  modifyTime: number;
  accessTime: number;
  permissions: number;
  owner: number;
  group: number;
}

export interface TransferItem {
  id: string;
  localPath: string;
  remotePath: string;
  direction: 'upload' | 'download';
  size: number;
  transferred: number;
  status: 'queued' | 'active' | 'paused' | 'completed' | 'failed';
  error?: string;
}

// --- Keychain Types ---

export interface KeyGenerateOptions {
  keyType: KeyType;
  bits?: number; // RSA: 2048/3072/4096, ECDSA: 256/384/521
  passphrase?: string;
  comment?: string;
  name: string;
}

export type KeyImportSource = 'file' | 'clipboard';

// --- UI / Theme Types ---

export interface TerminalTheme {
  name: string;
  foreground: string;
  background: string;
  cursor: string;
  cursorAccent: string;
  selection: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface UITheme {
  name: string;
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  border: string;
  danger: string;
  success: string;
  warning: string;
}

export interface NexusTheme {
  id: string;
  name: string;
  ui: UITheme;
  terminal: TerminalTheme;
  builtIn: boolean;
}

// --- Settings Types ---

export interface NexusSettings {
  autoLockTimeout: number;       // minutes, default 15
  clipboardClearTimeout: number; // seconds, default 30
  theme: string;                 // theme id
  terminalFont: string;          // default 'JetBrains Mono'
  terminalFontSize: number;      // default 14
  scrollbackLines: number;       // default 10000
  cursorStyle: 'block' | 'underline' | 'bar'; // default 'block'
  cursorBlink: boolean;          // default true
  sftpConcurrency: number;       // default 3
  gpuAcceleration: boolean;      // default true
  showHiddenFiles: boolean;      // default false
  defaultVaultPath: string;
}

// --- Vault Tree (UI convenience) ---

export interface VaultTreeNode {
  type: 'vault' | 'group' | 'host';
  id: string;
  label: string;
  icon?: string;
  colour?: string;
  children?: VaultTreeNode[];
  parentId?: string;
  vaultId: string;
}

// ============================================================
// App updates (src/main/updater)
// ============================================================

/**
 * How this build updates itself:
 * - `install`: Windows installer builds download the update in the background (electron-updater)
 *   and ask before restarting into it.
 * - `notify`: macOS (unsigned apps can't self-update) and anything else only say a newer
 *   version exists and link to the downloads page.
 * - `off`: dev / E2E builds, or checks turned off in Settings.
 */
export type UpdateMode = 'install' | 'notify' | 'off';

export type UpdateStatus =
  | { state: 'idle'; mode: UpdateMode }
  | { state: 'checking'; mode: UpdateMode }
  | { state: 'up-to-date'; mode: UpdateMode }
  /** A newer version exists. In `install` mode it is downloading. */
  | { state: 'available'; mode: UpdateMode; version: string }
  /** `install` mode only: downloaded and ready for "Restart to update". */
  | { state: 'downloaded'; mode: UpdateMode; version: string }
  | { state: 'error'; mode: UpdateMode; message: string };
