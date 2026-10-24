// ============================================================
// Nexus SSH Client — Vault CRUD Operations
// All database read/write operations for the encrypted vault.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { vaultEngine } from './index';
import { DEFAULT_SSH_PORT, DEFAULT_KEEPALIVE_INTERVAL } from '../../shared/constants';
import type {
  Vault,
  Group,
  Host,
  Identity,
  SSHKey,
  Tag,
  KnownHost,
  Snippet,
  SyncState,
  ResolvedCredentials,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// Helpers — wrap SQLCipher's callback-based API in Promises
// ---------------------------------------------------------------------------

function dbRun(sql: string, params: unknown[] = []): Promise<void> {
  const db = vaultEngine.getDb();
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function dbGet<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  const db = vaultEngine.getDb();
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err: Error | null, row: T) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const db = vaultEngine.getDb();
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err: Error | null, rows: T[]) => {
      if (err) reject(err);
      else resolve(rows ?? []);
    });
  });
}

// ---------------------------------------------------------------------------
// Row-mapping helpers for boolean fields stored as INTEGER (0/1)
// ---------------------------------------------------------------------------

/** A table row as SQLite returns it: booleans are still 0/1. */
type HostRow = Omit<Host, 'compression'> & { compression: number };
type KnownHostRow = Omit<KnownHost, 'trusted'> & { trusted: number };
type SnippetRow = Omit<Snippet, 'run_on_connect'> & { run_on_connect: number };
type SyncStateRow = Omit<SyncState, 'enabled'> & { enabled: number };

function mapHostRow(row: HostRow | undefined): Host | undefined {
  if (!row) return undefined;
  return {
    ...row,
    compression: !!row.compression,
  };
}

function mapKnownHostRow(row: KnownHostRow | undefined): KnownHost | undefined {
  if (!row) return undefined;
  return {
    ...row,
    trusted: !!row.trusted,
  };
}

function mapSnippetRow(row: SnippetRow | undefined): Snippet | undefined {
  if (!row) return undefined;
  return {
    ...row,
    run_on_connect: !!row.run_on_connect,
  };
}

function mapSyncStateRow(row: SyncStateRow | undefined): SyncState | undefined {
  if (!row) return undefined;
  return {
    ...row,
    enabled: !!row.enabled,
  };
}

// ============================================================
// Vaults (organisational containers)
// ============================================================

export async function listVaults(): Promise<Vault[]> {
  return dbAll<Vault>('SELECT * FROM vaults ORDER BY sort_order ASC, name ASC');
}

export async function createVault(data: {
  name: string;
  description?: string;
  icon?: string;
}): Promise<Vault> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO vaults (id, name, description, icon, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
    [id, data.name, data.description ?? null, data.icon ?? null, now, now],
  );
  const vault = await dbGet<Vault>('SELECT * FROM vaults WHERE id = ?', [id]);
  return vault!;
}

export async function updateVault(
  id: string,
  data: Partial<Pick<Vault, 'name' | 'description' | 'icon' | 'sort_order'>>,
): Promise<Vault> {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (data.name !== undefined) {
    fields.push('name = ?');
    params.push(data.name);
  }
  if (data.description !== undefined) {
    fields.push('description = ?');
    params.push(data.description);
  }
  if (data.icon !== undefined) {
    fields.push('icon = ?');
    params.push(data.icon);
  }
  if (data.sort_order !== undefined) {
    fields.push('sort_order = ?');
    params.push(data.sort_order);
  }

  if (fields.length === 0) {
    const vault = await dbGet<Vault>('SELECT * FROM vaults WHERE id = ?', [id]);
    if (!vault) throw new Error(`Vault not found: ${id}`);
    return vault;
  }

  fields.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);

  await dbRun(`UPDATE vaults SET ${fields.join(', ')} WHERE id = ?`, params);
  const vault = await dbGet<Vault>('SELECT * FROM vaults WHERE id = ?', [id]);
  if (!vault) throw new Error(`Vault not found: ${id}`);
  return vault;
}

export async function deleteVault(id: string): Promise<void> {
  await dbRun('DELETE FROM vaults WHERE id = ?', [id]);
}

// ============================================================
// Groups
// ============================================================

export async function listGroups(vaultId: string): Promise<Group[]> {
  return dbAll<Group>(
    'SELECT * FROM groups WHERE vault_id = ? ORDER BY sort_order ASC, name ASC',
    [vaultId],
  );
}

export async function createGroup(data: {
  vault_id: string;
  parent_id?: string;
  name: string;
  description?: string;
  icon?: string;
  default_port?: number;
  default_username?: string;
  default_identity_id?: string;
}): Promise<Group> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO groups (id, vault_id, parent_id, name, description, icon, sort_order,
       default_port, default_username, default_identity_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    [
      id,
      data.vault_id,
      data.parent_id ?? null,
      data.name,
      data.description ?? null,
      data.icon ?? null,
      data.default_port ?? null,
      data.default_username ?? null,
      data.default_identity_id ?? null,
      now,
      now,
    ],
  );
  const group = await dbGet<Group>('SELECT * FROM groups WHERE id = ?', [id]);
  return group!;
}

export async function updateGroup(
  id: string,
  data: Partial<Omit<Group, 'id' | 'created_at' | 'updated_at'>>,
): Promise<Group> {
  const fields: string[] = [];
  const params: unknown[] = [];

  const allowedFields: (keyof typeof data)[] = [
    'vault_id', 'parent_id', 'name', 'description', 'icon', 'sort_order',
    'default_port', 'default_username', 'default_identity_id',
  ];

  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(data[key]);
    }
  }

  if (fields.length === 0) {
    const group = await dbGet<Group>('SELECT * FROM groups WHERE id = ?', [id]);
    if (!group) throw new Error(`Group not found: ${id}`);
    return group;
  }

  fields.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);

  await dbRun(`UPDATE groups SET ${fields.join(', ')} WHERE id = ?`, params);
  const group = await dbGet<Group>('SELECT * FROM groups WHERE id = ?', [id]);
  if (!group) throw new Error(`Group not found: ${id}`);
  return group;
}

export async function deleteGroup(id: string): Promise<void> {
  await dbRun('DELETE FROM groups WHERE id = ?', [id]);
}

// ============================================================
// Hosts
// ============================================================

export async function listHosts(vaultId: string): Promise<Host[]> {
  const rows = await dbAll<HostRow>(
    'SELECT * FROM hosts WHERE vault_id = ? ORDER BY sort_order ASC, label ASC',
    [vaultId],
  );
  return rows.map((r) => mapHostRow(r)!);
}

export async function getHost(id: string): Promise<Host | undefined> {
  const row = await dbGet<HostRow>('SELECT * FROM hosts WHERE id = ?', [id]);
  return mapHostRow(row);
}

export async function createHost(data: {
  vault_id: string;
  group_id?: string;
  label: string;
  hostname: string;
  port?: number;
  username?: string;
  password?: string;
  identity_id?: string;
  key_id?: string;
  keepalive_interval?: number;
  compression?: boolean;
  os_type?: string;
  notes?: string;
  colour?: string;
}): Promise<Host> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO hosts (id, vault_id, group_id, label, hostname, port, username, password,
       identity_id, key_id, keepalive_interval, compression, os_type, notes, colour, sort_order,
       last_connected, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    [
      id,
      data.vault_id,
      data.group_id ?? null,
      data.label,
      data.hostname,
      data.port ?? DEFAULT_SSH_PORT,
      data.username ?? null,
      data.password ?? null,
      data.identity_id ?? null,
      data.key_id ?? null,
      data.keepalive_interval ?? DEFAULT_KEEPALIVE_INTERVAL,
      data.compression ? 1 : 0,
      data.os_type ?? null,
      data.notes ?? null,
      data.colour ?? null,
      now,
      now,
    ],
  );
  const host = await getHost(id);
  return host!;
}

export async function updateHost(
  id: string,
  data: Partial<Omit<Host, 'id' | 'created_at' | 'updated_at'>>,
): Promise<Host> {
  const fields: string[] = [];
  const params: unknown[] = [];

  const directFields = [
    'vault_id', 'group_id', 'label', 'hostname', 'port', 'username',
    'password', 'identity_id', 'key_id', 'keepalive_interval', 'os_type', 'notes',
    'colour', 'sort_order', 'last_connected',
  ] as const;

  for (const key of directFields) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(data[key]);
    }
  }

  // Boolean field: compression
  if (data.compression !== undefined) {
    fields.push('compression = ?');
    params.push(data.compression ? 1 : 0);
  }

  if (fields.length === 0) {
    const host = await getHost(id);
    if (!host) throw new Error(`Host not found: ${id}`);
    return host;
  }

  fields.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);

  await dbRun(`UPDATE hosts SET ${fields.join(', ')} WHERE id = ?`, params);
  const host = await getHost(id);
  if (!host) throw new Error(`Host not found: ${id}`);
  return host;
}

export async function deleteHost(id: string): Promise<void> {
  await dbRun('DELETE FROM hosts WHERE id = ?', [id]);
}

export async function updateLastConnected(id: string): Promise<void> {
  const now = new Date().toISOString();
  await dbRun('UPDATE hosts SET last_connected = ?, updated_at = ? WHERE id = ?', [now, now, id]);
}

// ============================================================
// Credential Inheritance Resolution
// ============================================================

export async function resolveCredentials(hostId: string): Promise<ResolvedCredentials> {
  // 1. Get the host
  const host = await getHost(hostId);
  if (!host) throw new Error(`Host not found: ${hostId}`);

  // 2. Start with host's own values
  let hostname = host.hostname;
  let port: number | null = host.port;
  let username: string | null = host.username;
  let password: string | null = host.password;
  let identityId: string | null = host.identity_id;

  // 3. Walk up the group chain for missing values
  let groupId: string | null = host.group_id;
  while (groupId && (username === null || port === null || identityId === null)) {
    const group = await dbGet<Group>('SELECT * FROM groups WHERE id = ?', [groupId]);
    if (!group) break;

    if (username === null && group.default_username !== null) {
      username = group.default_username;
    }
    if (port === null && group.default_port !== null) {
      port = group.default_port;
    }
    if (identityId === null && group.default_identity_id !== null) {
      identityId = group.default_identity_id;
    }

    groupId = group.parent_id;
  }

  // Apply defaults if still null
  if (port === null) port = DEFAULT_SSH_PORT;

  // 4. If identity_id is resolved, load the identity
  let privateKey: string | undefined;
  let passphrase: string | undefined;

  if (identityId) {
    const identity = await dbGet<Identity>('SELECT * FROM identities WHERE id = ?', [identityId]);
    if (identity) {
      // Identity username overrides if host had no username
      if (username === null && identity.username !== null) {
        username = identity.username;
      }
      // Identity password as fallback
      if (password === null && identity.password !== null) {
        password = identity.password;
      }
      // Load SSH key if referenced
      if (identity.key_id) {
        const sshKey = await dbGet<SSHKey>('SELECT * FROM ssh_keys WHERE id = ?', [identity.key_id]);
        if (sshKey) {
          privateKey = sshKey.private_key;
          passphrase = sshKey.passphrase ?? undefined;
        }
      }
    }
  }

  // 4b. If host has a direct key_id (non-identity SSH key mode), use it
  if (!privateKey && host.key_id) {
    const sshKey = await dbGet<SSHKey>('SELECT * FROM ssh_keys WHERE id = ?', [host.key_id]);
    if (sshKey) {
      privateKey = sshKey.private_key;
      passphrase = sshKey.passphrase ?? undefined;
    }
  }

  // 5. Build result
  const result: ResolvedCredentials = {
    hostname,
    port,
    username: username ?? '',
  };
  if (password !== null) result.password = password;
  if (privateKey !== undefined) result.privateKey = privateKey;
  if (passphrase !== undefined) result.passphrase = passphrase;

  return result;
}

// ============================================================
// Identities
// ============================================================

export async function listIdentities(vaultId: string): Promise<Identity[]> {
  return dbAll<Identity>(
    'SELECT * FROM identities WHERE vault_id = ? ORDER BY name ASC',
    [vaultId],
  );
}

export async function createIdentity(data: {
  vault_id: string;
  name: string;
  username?: string;
  password?: string;
  key_id?: string;
}): Promise<Identity> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO identities (id, vault_id, name, username, password, key_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.vault_id,
      data.name,
      data.username ?? null,
      data.password ?? null,
      data.key_id ?? null,
      now,
      now,
    ],
  );
  const identity = await dbGet<Identity>('SELECT * FROM identities WHERE id = ?', [id]);
  return identity!;
}

export async function updateIdentity(
  id: string,
  data: Partial<Omit<Identity, 'id' | 'created_at' | 'updated_at'>>,
): Promise<Identity> {
  const fields: string[] = [];
  const params: unknown[] = [];

  const allowedFields = ['vault_id', 'name', 'username', 'password', 'key_id'] as const;

  for (const key of allowedFields) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(data[key]);
    }
  }

  if (fields.length === 0) {
    const identity = await dbGet<Identity>('SELECT * FROM identities WHERE id = ?', [id]);
    if (!identity) throw new Error(`Identity not found: ${id}`);
    return identity;
  }

  fields.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);

  await dbRun(`UPDATE identities SET ${fields.join(', ')} WHERE id = ?`, params);
  const identity = await dbGet<Identity>('SELECT * FROM identities WHERE id = ?', [id]);
  if (!identity) throw new Error(`Identity not found: ${id}`);
  return identity;
}

export async function deleteIdentity(id: string): Promise<void> {
  await dbRun('DELETE FROM identities WHERE id = ?', [id]);
}

// ============================================================
// SSH Keys
// ============================================================

export async function listSSHKeys(vaultId: string): Promise<SSHKey[]> {
  return dbAll<SSHKey>(
    'SELECT * FROM ssh_keys WHERE vault_id = ? ORDER BY name ASC',
    [vaultId],
  );
}

export async function getSSHKey(id: string): Promise<SSHKey | undefined> {
  return dbGet<SSHKey>('SELECT * FROM ssh_keys WHERE id = ?', [id]);
}

export async function saveSSHKey(key: SSHKey): Promise<void> {
  const now = new Date().toISOString();
  await dbRun(
    `INSERT OR REPLACE INTO ssh_keys (id, vault_id, name, key_type, bits, fingerprint,
       public_key, private_key, passphrase, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      key.id,
      key.vault_id,
      key.name,
      key.key_type,
      key.bits ?? null,
      key.fingerprint,
      key.public_key,
      key.private_key,
      key.passphrase ?? null,
      key.created_at ?? now,
      now,
    ],
  );
}

export async function deleteSSHKey(id: string): Promise<void> {
  await dbRun('DELETE FROM ssh_keys WHERE id = ?', [id]);
}

// ============================================================
// Tags
// ============================================================

export async function listTags(): Promise<Tag[]> {
  return dbAll<Tag>('SELECT * FROM tags ORDER BY name ASC');
}

export async function createTag(data: { name: string; colour?: string }): Promise<Tag> {
  const id = uuidv4();
  await dbRun(
    'INSERT INTO tags (id, name, colour) VALUES (?, ?, ?)',
    [id, data.name, data.colour ?? null],
  );
  const tag = await dbGet<Tag>('SELECT * FROM tags WHERE id = ?', [id]);
  return tag!;
}

export async function updateTag(
  id: string,
  data: Partial<Pick<Tag, 'name' | 'colour'>>,
): Promise<Tag> {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (data.name !== undefined) {
    fields.push('name = ?');
    params.push(data.name);
  }
  if (data.colour !== undefined) {
    fields.push('colour = ?');
    params.push(data.colour);
  }

  if (fields.length === 0) {
    const tag = await dbGet<Tag>('SELECT * FROM tags WHERE id = ?', [id]);
    if (!tag) throw new Error(`Tag not found: ${id}`);
    return tag;
  }

  params.push(id);
  await dbRun(`UPDATE tags SET ${fields.join(', ')} WHERE id = ?`, params);
  const tag = await dbGet<Tag>('SELECT * FROM tags WHERE id = ?', [id]);
  if (!tag) throw new Error(`Tag not found: ${id}`);
  return tag;
}

export async function deleteTag(id: string): Promise<void> {
  await dbRun('DELETE FROM tags WHERE id = ?', [id]);
}

export async function setHostTags(hostId: string, tagIds: string[]): Promise<void> {
  // Delete all existing tags for this host
  await dbRun('DELETE FROM host_tags WHERE host_id = ?', [hostId]);
  // Insert new associations
  for (const tagId of tagIds) {
    await dbRun('INSERT INTO host_tags (host_id, tag_id) VALUES (?, ?)', [hostId, tagId]);
  }
}

export async function getHostTags(hostId: string): Promise<Tag[]> {
  return dbAll<Tag>(
    `SELECT t.* FROM tags t
     INNER JOIN host_tags ht ON ht.tag_id = t.id
     WHERE ht.host_id = ?
     ORDER BY t.name ASC`,
    [hostId],
  );
}

// ============================================================
// Known Hosts
// ============================================================

export async function listKnownHosts(): Promise<KnownHost[]> {
  const rows = await dbAll<KnownHostRow>('SELECT * FROM known_hosts ORDER BY hostname ASC, port ASC');
  return rows.map((r) => mapKnownHostRow(r)!);
}

export async function findKnownHost(hostname: string, port: number): Promise<KnownHost[]> {
  const rows = await dbAll<KnownHostRow>(
    'SELECT * FROM known_hosts WHERE hostname = ? AND port = ?',
    [hostname, port],
  );
  return rows.map((r) => mapKnownHostRow(r)!);
}

export async function upsertKnownHost(data: {
  hostname: string;
  port: number;
  key_type: string;
  public_key: string;
}): Promise<KnownHost> {
  const now = new Date().toISOString();

  // Check if an entry already exists for this unique combination
  const existing = await dbGet<KnownHostRow>(
    'SELECT * FROM known_hosts WHERE hostname = ? AND port = ? AND key_type = ?',
    [data.hostname, data.port, data.key_type],
  );

  let id: string;
  if (existing) {
    id = existing.id;
    await dbRun(
      `UPDATE known_hosts SET public_key = ?, last_seen = ? WHERE id = ?`,
      [data.public_key, now, id],
    );
  } else {
    id = uuidv4();
    await dbRun(
      `INSERT INTO known_hosts (id, hostname, port, key_type, public_key, first_seen, last_seen, trusted)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, data.hostname, data.port, data.key_type, data.public_key, now, now],
    );
  }

  const row = await dbGet<KnownHostRow>('SELECT * FROM known_hosts WHERE id = ?', [id]);
  return mapKnownHostRow(row)!;
}

export async function deleteKnownHost(id: string): Promise<void> {
  await dbRun('DELETE FROM known_hosts WHERE id = ?', [id]);
}

export async function trustKnownHost(id: string, trusted: boolean): Promise<void> {
  await dbRun('UPDATE known_hosts SET trusted = ? WHERE id = ?', [trusted ? 1 : 0, id]);
}

// ============================================================
// Snippets
// ============================================================

export async function listSnippets(vaultId: string): Promise<Snippet[]> {
  const rows = await dbAll<SnippetRow>(
    'SELECT * FROM snippets WHERE vault_id = ? ORDER BY sort_order ASC, name ASC',
    [vaultId],
  );
  return rows.map((r) => mapSnippetRow(r)!);
}

export async function createSnippet(data: {
  vault_id: string;
  name: string;
  command: string;
  description?: string;
  run_on_connect?: boolean;
}): Promise<Snippet> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await dbRun(
    `INSERT INTO snippets (id, vault_id, name, command, description, run_on_connect, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      data.vault_id,
      data.name,
      data.command,
      data.description ?? null,
      data.run_on_connect ? 1 : 0,
      now,
      now,
    ],
  );
  const rows = await dbAll<SnippetRow>('SELECT * FROM snippets WHERE id = ?', [id]);
  return mapSnippetRow(rows[0])!;
}

export async function updateSnippet(
  id: string,
  data: Partial<Omit<Snippet, 'id' | 'created_at' | 'updated_at'>>,
): Promise<Snippet> {
  const fields: string[] = [];
  const params: unknown[] = [];

  const directFields = ['vault_id', 'name', 'command', 'description', 'sort_order'] as const;

  for (const key of directFields) {
    if (data[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(data[key]);
    }
  }

  // Boolean field: run_on_connect
  if (data.run_on_connect !== undefined) {
    fields.push('run_on_connect = ?');
    params.push(data.run_on_connect ? 1 : 0);
  }

  if (fields.length === 0) {
    const row = await dbGet<SnippetRow>('SELECT * FROM snippets WHERE id = ?', [id]);
    if (!row) throw new Error(`Snippet not found: ${id}`);
    return mapSnippetRow(row)!;
  }

  fields.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);

  await dbRun(`UPDATE snippets SET ${fields.join(', ')} WHERE id = ?`, params);
  const row = await dbGet<SnippetRow>('SELECT * FROM snippets WHERE id = ?', [id]);
  if (!row) throw new Error(`Snippet not found: ${id}`);
  return mapSnippetRow(row)!;
}

export async function deleteSnippet(id: string): Promise<void> {
  await dbRun('DELETE FROM snippets WHERE id = ?', [id]);
}

// ============================================================
// Sync State
// ============================================================

export async function getSyncState(_vaultId?: string): Promise<SyncState | undefined> {
  // The sync_state table does not have a vault_id column — it's a singleton-style table.
  // If vaultId is provided we ignore it (kept for API compatibility); we return the first row.
  const row = await dbGet<SyncStateRow>('SELECT * FROM sync_state LIMIT 1');
  return mapSyncStateRow(row);
}

export async function upsertSyncState(
  data: Partial<SyncState> & { backend_type: string; backend_config: string },
): Promise<SyncState> {
  const now = new Date().toISOString();

  const existing = await dbGet<SyncStateRow>('SELECT * FROM sync_state LIMIT 1');

  let id: string;
  if (existing) {
    id = existing.id;
    const fields: string[] = [];
    const params: unknown[] = [];

    fields.push('backend_type = ?');
    params.push(data.backend_type);

    fields.push('backend_config = ?');
    params.push(data.backend_config);

    if (data.last_sync_at !== undefined) {
      fields.push('last_sync_at = ?');
      params.push(data.last_sync_at);
    }
    if (data.last_sync_hash !== undefined) {
      fields.push('last_sync_hash = ?');
      params.push(data.last_sync_hash);
    }
    if (data.sync_interval !== undefined) {
      fields.push('sync_interval = ?');
      params.push(data.sync_interval);
    }
    if (data.enabled !== undefined) {
      fields.push('enabled = ?');
      params.push(data.enabled ? 1 : 0);
    }

    fields.push('updated_at = ?');
    params.push(now);
    params.push(id);

    await dbRun(`UPDATE sync_state SET ${fields.join(', ')} WHERE id = ?`, params);
  } else {
    id = data.id ?? uuidv4();
    await dbRun(
      `INSERT INTO sync_state (id, backend_type, backend_config, last_sync_at, last_sync_hash,
         sync_interval, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.backend_type,
        data.backend_config,
        data.last_sync_at ?? null,
        data.last_sync_hash ?? null,
        data.sync_interval ?? 300,
        data.enabled !== undefined ? (data.enabled ? 1 : 0) : 1,
        now,
        now,
      ],
    );
  }

  const row = await dbGet<SyncStateRow>('SELECT * FROM sync_state WHERE id = ?', [id]);
  return mapSyncStateRow(row)!;
}
