// ============================================================
// Nexus SSH Client — Shared Constants
// ============================================================

// --- Argon2id Parameters ---
export const ARGON2_OPS_LIMIT = 3;
export const ARGON2_MEM_LIMIT = 268435456; // 256 MiB
export const ARGON2_SALT_BYTES = 16;
export const ARGON2_KEY_BYTES = 32;

// PIN unlock uses lighter params
export const PIN_ARGON2_OPS_LIMIT = 1;
export const PIN_ARGON2_MEM_LIMIT = 67108864; // 64 MiB
export const PIN_MAX_ATTEMPTS = 3;

// --- SQLCipher ---
export const SQLCIPHER_PAGE_SIZE = 4096;

// --- SSH Defaults ---
export const DEFAULT_SSH_PORT = 22;
export const DEFAULT_KEEPALIVE_INTERVAL = 60; // seconds
export const DEFAULT_TERM_TYPE = 'xterm-256color';

// --- Terminal Defaults ---
export const DEFAULT_FONT = 'JetBrains Mono';
export const DEFAULT_FONT_SIZE = 14;
export const DEFAULT_SCROLLBACK = 10000;

// --- SFTP ---
export const DEFAULT_SFTP_CONCURRENCY = 3;

// --- Security ---
export const DEFAULT_AUTO_LOCK_TIMEOUT = 15; // minutes
export const DEFAULT_CLIPBOARD_CLEAR_TIMEOUT = 30; // seconds

// --- Sync ---
export const DEFAULT_SYNC_INTERVAL = 300; // 5 minutes in seconds

// --- Vault File ---
export const VAULT_FILE_EXTENSION = '.db';
export const VAULT_SALT_EXTENSION = '.salt';
export const VAULT_DEFAULT_DIR_NAME = 'vaults';

// --- App ---
export const APP_NAME = 'Nexus';
export const APP_ID = 'com.punterdigital.nexus';

// --- Schema ---
export const SCHEMA_VERSION = 1;

// --- IPC Channels ---
export const IPC = {
  // Vault
  VAULT_CREATE: 'vault:create',
  VAULT_UNLOCK: 'vault:unlock',
  VAULT_LOCK: 'vault:lock',
  VAULT_EXISTS: 'vault:exists',
  VAULT_CHANGE_PASSWORD: 'vault:change-password',
  VAULT_LIST: 'vault:list',
  VAULT_SWITCH: 'vault:switch',
  VAULT_CURRENT: 'vault:current',

  // Hardware key (FIDO2/WebAuthn PRF) unlock
  HWKEY_HAS: 'hwkey:has',
  HWKEY_GET_INFO: 'hwkey:get-info',
  HWKEY_SETUP: 'hwkey:setup',
  HWKEY_CREATE_PASSWORDLESS: 'hwkey:create-passwordless',
  HWKEY_UNLOCK: 'hwkey:unlock',
  HWKEY_REMOVE: 'hwkey:remove',

  // Vaults (organisational containers inside the DB)
  VAULTS_LIST: 'vaults:list',
  VAULTS_CREATE: 'vaults:create',
  VAULTS_UPDATE: 'vaults:update',
  VAULTS_DELETE: 'vaults:delete',

  // Groups
  GROUPS_LIST: 'groups:list',
  GROUPS_CREATE: 'groups:create',
  GROUPS_UPDATE: 'groups:update',
  GROUPS_DELETE: 'groups:delete',

  // Hosts
  HOSTS_LIST: 'hosts:list',
  HOSTS_CREATE: 'hosts:create',
  HOSTS_UPDATE: 'hosts:update',
  HOSTS_DELETE: 'hosts:delete',
  HOSTS_GET: 'hosts:get',
  HOSTS_RESOLVE_CREDENTIALS: 'hosts:resolve-credentials',

  // Identities
  IDENTITIES_LIST: 'identities:list',
  IDENTITIES_CREATE: 'identities:create',
  IDENTITIES_UPDATE: 'identities:update',
  IDENTITIES_DELETE: 'identities:delete',

  // Tags
  TAGS_LIST: 'tags:list',
  TAGS_CREATE: 'tags:create',
  TAGS_UPDATE: 'tags:update',
  TAGS_DELETE: 'tags:delete',
  HOST_TAGS_SET: 'host-tags:set',
  HOST_TAGS_GET: 'host-tags:get',

  // SSH
  SSH_CONNECT: 'ssh:connect',
  SSH_TEST_CONNECT: 'ssh:test-connect',
  SSH_MARK_READY: 'ssh:mark-ready',
  SSH_DISCONNECT: 'ssh:disconnect',
  SSH_WRITE: 'ssh:write',
  SSH_RESIZE: 'ssh:resize',
  SSH_LIST_SESSIONS: 'ssh:list-sessions',
  SSH_DATA: 'ssh:data',
  SSH_CLOSE: 'ssh:close',
  SSH_HOST_KEY_PROMPT: 'ssh:host-key-prompt',
  SSH_HOST_KEY_RESPONSE: 'ssh:host-key-response',
  SSH_HOST_KEY_DISMISS: 'ssh:host-key-dismiss',

  // SFTP
  SFTP_LIST: 'sftp:list',
  FS_LIST: 'fs:list',
  FS_HOME: 'fs:home',
  FS_OPEN_VAULT_DIR: 'fs:open-vault-dir',
  FS_PICK_DIRECTORY: 'fs:pick-directory',
  FS_PICK_FILE: 'fs:pick-file',
  SFTP_UPLOAD: 'sftp:upload',
  SFTP_DOWNLOAD: 'sftp:download',
  SFTP_MKDIR: 'sftp:mkdir',
  SFTP_DELETE: 'sftp:delete',
  SFTP_RENAME: 'sftp:rename',
  SFTP_STAT: 'sftp:stat',
  SFTP_CHMOD: 'sftp:chmod',
  SFTP_TRANSFER_PROGRESS: 'sftp:transfer-progress',
  SFTP_TRANSFER_PAUSE: 'sftp:transfer-pause',
  SFTP_TRANSFER_RESUME: 'sftp:transfer-resume',
  SFTP_TRANSFER_CANCEL: 'sftp:transfer-cancel',

  // Keychain
  KEYCHAIN_LIST: 'keychain:list',
  KEYCHAIN_GENERATE: 'keychain:generate',
  KEYCHAIN_IMPORT: 'keychain:import',
  KEYCHAIN_DELETE: 'keychain:delete',
  KEYCHAIN_GET_PUBLIC: 'keychain:get-public',
  KEYCHAIN_GET_FULL: 'keychain:get-full',
  KEYCHAIN_EXPORT_PUBLIC: 'keychain:export-public',

  // Sync
  SYNC_CONFIGURE: 'sync:configure',
  SYNC_GET_CONFIG: 'sync:get-config',
  SYNC_PUSH: 'sync:push',
  SYNC_PULL: 'sync:pull',
  SYNC_GET_STATUS: 'sync:get-status',
  SYNC_SET_ENABLED: 'sync:set-enabled',
  SYNC_TEST_CONNECTION: 'sync:test-connection',
  SYNC_STATUS_UPDATE: 'sync:status-update',

  // Snippets
  SNIPPETS_LIST: 'snippets:list',
  SNIPPETS_CREATE: 'snippets:create',
  SNIPPETS_UPDATE: 'snippets:update',
  SNIPPETS_DELETE: 'snippets:delete',
  SNIPPETS_EXECUTE: 'snippets:execute',

  // Known Hosts
  KNOWN_HOSTS_LIST: 'known-hosts:list',
  KNOWN_HOSTS_DELETE: 'known-hosts:delete',
  KNOWN_HOSTS_TRUST: 'known-hosts:trust',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:get-all',
  SETTINGS_RESET: 'settings:reset',
  SETTINGS_CHANGED: 'settings:changed',

  APP_SETTINGS_GET: 'app-settings:get',
  APP_SETTINGS_SET: 'app-settings:set',
  APP_SETTINGS_GET_ALL: 'app-settings:get-all',

  // Clipboard
  CLIPBOARD_COPY_SECURE: 'clipboard:copy-secure',

  // Security
  SECURITY_VAULT_LOCKED: 'security:vault-locked',

  // App updates
  UPDATER_GET_STATUS: 'updater:get-status',
  UPDATER_CHECK: 'updater:check',
  UPDATER_INSTALL: 'updater:install',
  UPDATER_OPEN_DOWNLOADS: 'updater:open-downloads',
  UPDATER_STATUS: 'updater:status',
} as const;

// ── App updates ──────────────────────────────────────────────
/** Where macOS (and any build that can't self-install) sends people for a new version. */
export const DOWNLOADS_PAGE_URL = 'https://punterdigital.github.io/personal-apps/';
/** Latest published release, used by `notify` mode (electron-updater reads latest.yml itself). */
export const LATEST_RELEASE_API_URL =
  'https://api.github.com/repos/PunterDigital/nexus-ssh/releases/latest';
/** App-level setting (app-settings.json) that turns automatic update checks off. Default on. */
export const UPDATE_CHECK_SETTING = 'checkForUpdates';
/** First check a few seconds after launch (never during startup), then every 6 hours. */
export const UPDATE_FIRST_CHECK_DELAY_MS = 5_000;
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
