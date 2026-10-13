// ============================================================
// Nexus SSH Client — Vault SQL Schema
// All CREATE TABLE statements for the encrypted SQLCipher DB.
// ============================================================

export const VAULT_SCHEMA = `
-- Metadata key-value store
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Organisational vaults (top-level containers)
CREATE TABLE IF NOT EXISTS vaults (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- SSH key material
CREATE TABLE IF NOT EXISTS ssh_keys (
  id          TEXT PRIMARY KEY,
  vault_id    TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  key_type    TEXT NOT NULL,
  bits        INTEGER,
  fingerprint TEXT NOT NULL,
  public_key  TEXT NOT NULL,
  private_key TEXT NOT NULL,
  passphrase  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Identities (username + optional key reference)
CREATE TABLE IF NOT EXISTS identities (
  id          TEXT PRIMARY KEY,
  vault_id    TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  username    TEXT,
  password    TEXT,
  key_id      TEXT REFERENCES ssh_keys(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Folder / group hierarchy
CREATE TABLE IF NOT EXISTS groups (
  id                  TEXT PRIMARY KEY,
  vault_id            TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  parent_id           TEXT REFERENCES groups(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description         TEXT,
  icon                TEXT,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  default_port        INTEGER,
  default_username    TEXT,
  default_identity_id TEXT REFERENCES identities(id),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- Host connections
CREATE TABLE IF NOT EXISTS hosts (
  id                 TEXT PRIMARY KEY,
  vault_id           TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  group_id           TEXT REFERENCES groups(id) ON DELETE SET NULL,
  label              TEXT NOT NULL,
  hostname           TEXT NOT NULL,
  port               INTEGER NOT NULL DEFAULT 22,
  username           TEXT,
  password           TEXT,
  identity_id        TEXT REFERENCES identities(id),
  key_id             TEXT REFERENCES ssh_keys(id),
  keepalive_interval INTEGER NOT NULL DEFAULT 60,
  compression        INTEGER NOT NULL DEFAULT 0,
  os_type            TEXT,
  notes              TEXT,
  colour             TEXT,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  last_connected     TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  colour TEXT
);

-- Many-to-many host ↔ tag
CREATE TABLE IF NOT EXISTS host_tags (
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (host_id, tag_id)
);

-- SSH host key fingerprint store
CREATE TABLE IF NOT EXISTS known_hosts (
  id         TEXT PRIMARY KEY,
  hostname   TEXT NOT NULL,
  port       INTEGER NOT NULL DEFAULT 22,
  key_type   TEXT NOT NULL,
  public_key TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  trusted    INTEGER NOT NULL DEFAULT 1,
  UNIQUE (hostname, port, key_type)
);

-- Command snippets
CREATE TABLE IF NOT EXISTS snippets (
  id             TEXT PRIMARY KEY,
  vault_id       TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  command        TEXT NOT NULL,
  description    TEXT,
  run_on_connect INTEGER NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- Sync backend state
CREATE TABLE IF NOT EXISTS sync_state (
  id             TEXT PRIMARY KEY,
  backend_type   TEXT NOT NULL,
  backend_config TEXT NOT NULL,
  last_sync_at   TEXT,
  last_sync_hash TEXT,
  sync_interval  INTEGER NOT NULL DEFAULT 300,
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
`;
