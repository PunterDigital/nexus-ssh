// ============================================================
// Nexus SSH Client — Vault Engine
// Manages the encrypted SQLCipher database lifecycle:
// create, unlock, lock, destroy.
// ============================================================

import { promises as fs } from 'fs';
const { Database } = require('@journeyapps/sqlcipher');
// eslint-disable-next-line @typescript-eslint/no-redeclare -- type alias for the runtime class
type Database = InstanceType<typeof Database>;
import {
  SQLCIPHER_PAGE_SIZE,
  SCHEMA_VERSION,
  ARGON2_OPS_LIMIT,
  ARGON2_MEM_LIMIT,
} from '../../shared/constants';
import { VAULT_SCHEMA } from './schema';
import {
  initSodium,
  generateSalt,
  deriveKey,
  zeroBuffer,
} from '../kdf';

// ---------------------------------------------------------------------------
// Helpers — wrap SQLCipher's callback-based API in Promises
// ---------------------------------------------------------------------------

function dbRun(db: Database, sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function dbGet<T = unknown>(db: Database, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err: Error | null, row: T) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbExec(db: Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Run lightweight schema migrations for vaults created before new columns
 * were introduced. Each migration is idempotent — we detect the column/table
 * state via PRAGMA table_info and only apply changes when missing.
 */
async function runMigrations(db: Database): Promise<void> {
  // Fetch existing hosts columns
  const hostCols = await new Promise<Array<{ name: string }>>((resolve, reject) => {
    db.all(`PRAGMA table_info(hosts)`, [], (err: Error | null, rows: unknown) => {
      if (err) reject(err);
      else resolve((rows as Array<{ name: string }>) ?? []);
    });
  });
  const hostColNames = new Set(hostCols.map((c) => c.name));

  // Migration: add hosts.key_id (references ssh_keys(id))
  if (!hostColNames.has('key_id')) {
    await new Promise<void>((resolve, reject) => {
      db.run(
        `ALTER TABLE hosts ADD COLUMN key_id TEXT REFERENCES ssh_keys(id)`,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  }
}

function openDatabase(filePath: string): Promise<Database> {
  return new Promise((resolve, reject) => {
    const db = new Database(filePath, (err: Error | null) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

function closeDatabase(db: Database): Promise<void> {
  return new Promise((resolve, reject) => {
    db.close((err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// VaultEngine
// ---------------------------------------------------------------------------

class VaultEngine {
  private db: Database | null = null;
  private dbKey: Buffer | null = null;
  private vaultPath: string | null = null;
  /**
   * Cached master password (kept in memory only, zeroed on lock). Needed so
   * sync operations can reopen the vault after replacing the .db file on
   * Windows where open handles hold an exclusive lock.
   */
  private cachedPassword: string | null = null;
  private unlockListeners: Array<() => void> = [];

  /** Run `listener` every time a vault is opened (create, password, PIN or hardware-key unlock). */
  onUnlocked(listener: () => void): () => void {
    this.unlockListeners.push(listener);
    return () => {
      this.unlockListeners = this.unlockListeners.filter((l) => l !== listener);
    };
  }

  private notifyUnlocked(): void {
    for (const listener of this.unlockListeners) {
      try {
        listener();
      } catch {
        // A listener must never break unlocking
      }
    }
  }

  // -----------------------------------------------------------------------
  // Create a brand-new vault
  // -----------------------------------------------------------------------
  async create(vaultPath: string, password: string): Promise<void> {
    await initSodium();

    // 1. Generate and persist salt
    const salt = generateSalt();
    const saltPath = vaultPath + '.salt';
    await fs.writeFile(saltPath, salt.toString('base64'), 'utf-8');

    // 2. Derive encryption key
    const key = deriveKey(password, salt);
    const hexKey = key.toString('hex');

    // 3. Open database and apply SQLCipher pragmas
    const db = await openDatabase(vaultPath);

    try {
      await dbRun(db, `PRAGMA key = "x'${hexKey}'";`);
      await dbRun(db, `PRAGMA cipher_page_size = ${SQLCIPHER_PAGE_SIZE};`);
      await dbRun(db, `PRAGMA kdf_iter = 0;`);
      await dbRun(db, `PRAGMA foreign_keys = ON;`);

      // 4. Create schema
      await dbExec(db, VAULT_SCHEMA);

      // 5. Seed app_meta
      const now = new Date().toISOString();
      await dbRun(db, `INSERT INTO app_meta (key, value) VALUES (?, ?)`, [
        'schema_version',
        String(SCHEMA_VERSION),
      ]);
      await dbRun(db, `INSERT INTO app_meta (key, value) VALUES (?, ?)`, [
        'created_at',
        now,
      ]);
      await dbRun(db, `INSERT INTO app_meta (key, value) VALUES (?, ?)`, [
        'updated_at',
        now,
      ]);
      await dbRun(db, `INSERT INTO app_meta (key, value) VALUES (?, ?)`, [
        'argon2_ops_limit',
        String(ARGON2_OPS_LIMIT),
      ]);
      await dbRun(db, `INSERT INTO app_meta (key, value) VALUES (?, ?)`, [
        'argon2_mem_limit',
        String(ARGON2_MEM_LIMIT),
      ]);
    } catch (err) {
      // Clean up on failure
      zeroBuffer(key);
      await closeDatabase(db).catch(() => {});
      throw err;
    }

    // 6. Store state
    this.db = db;
    this.dbKey = key;
    this.vaultPath = vaultPath;
    this.cachedPassword = password;

    this.notifyUnlocked();
  }

  // -----------------------------------------------------------------------
  // Create a brand-new vault using a raw 32-byte DEK (no password, no
  // Argon2id, no .salt file). Used by the hardware-key passwordless path.
  // The caller is responsible for wrapping the DEK with the hardware key
  // and persisting the wrapped form (see hardware-key manager).
  // -----------------------------------------------------------------------
  async createWithKey(vaultPath: string, dbKey: Buffer): Promise<void> {
    await initSodium();

    if (dbKey.length !== 32) {
      throw new Error('DB key must be 32 bytes');
    }

    const hexKey = dbKey.toString('hex');
    const db = await openDatabase(vaultPath);

    try {
      await dbRun(db, `PRAGMA key = "x'${hexKey}'";`);
      await dbRun(db, `PRAGMA cipher_page_size = ${SQLCIPHER_PAGE_SIZE};`);
      await dbRun(db, `PRAGMA kdf_iter = 0;`);
      await dbRun(db, `PRAGMA foreign_keys = ON;`);

      await dbExec(db, VAULT_SCHEMA);

      const now = new Date().toISOString();
      await dbRun(db, `INSERT INTO app_meta (key, value) VALUES (?, ?)`, [
        'schema_version',
        String(SCHEMA_VERSION),
      ]);
      await dbRun(db, `INSERT INTO app_meta (key, value) VALUES (?, ?)`, [
        'created_at',
        now,
      ]);
      await dbRun(db, `INSERT INTO app_meta (key, value) VALUES (?, ?)`, [
        'updated_at',
        now,
      ]);
      await dbRun(db, `INSERT INTO app_meta (key, value) VALUES (?, ?)`, [
        'kdf',
        'raw',
      ]);
    } catch (err) {
      await closeDatabase(db).catch(() => {});
      throw err;
    }

    this.db = db;
    this.dbKey = Buffer.from(dbKey);
    this.vaultPath = vaultPath;
    this.cachedPassword = null;

    this.notifyUnlocked();
  }

  // -----------------------------------------------------------------------
  // Unlock with a raw 32-byte DEK. Used by the hardware-key path after
  // unwrapping the DEK from the encrypted .hwkey blob, and by PIN unlock,
  // which also hands back the master password so sync can reopen the vault.
  // -----------------------------------------------------------------------
  async unlockWithKey(
    vaultPath: string,
    dbKey: Buffer,
    options: { password?: string | null; wrongKeyMessage?: string } = {},
  ): Promise<void> {
    await initSodium();

    if (dbKey.length !== 32) {
      throw new Error('DB key must be 32 bytes');
    }

    const hexKey = dbKey.toString('hex');
    const db = await openDatabase(vaultPath);

    try {
      await dbRun(db, `PRAGMA key = "x'${hexKey}'";`);
      await dbRun(db, `PRAGMA cipher_page_size = ${SQLCIPHER_PAGE_SIZE};`);
      await dbRun(db, `PRAGMA kdf_iter = 0;`);
      await dbRun(db, `PRAGMA foreign_keys = ON;`);

      await dbGet(db, `SELECT count(*) AS cnt FROM hosts;`);

      await runMigrations(db);
    } catch (err: unknown) {
      await closeDatabase(db).catch(() => {});

      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes('SQLITE_NOTADB') ||
        message.includes('file is not a database') ||
        message.includes('not a database')
      ) {
        throw new Error(
          options.wrongKeyMessage ??
            'Hardware key did not unlock the vault. The credential may have been re-enrolled or the vault was created with a different key.',
        );
      }
      throw err;
    }

    this.db = db;
    this.dbKey = Buffer.from(dbKey);
    this.vaultPath = vaultPath;
    this.cachedPassword = options.password ?? null;

    this.notifyUnlocked();
  }

  // -----------------------------------------------------------------------
  // Unlock an existing vault
  // -----------------------------------------------------------------------
  async unlock(vaultPath: string, password: string): Promise<void> {
    await initSodium();

    // 1. Read salt
    const saltPath = vaultPath + '.salt';
    const saltBase64 = await fs.readFile(saltPath, 'utf-8');
    const salt = Buffer.from(saltBase64, 'base64');

    // 2. Derive key
    const key = deriveKey(password, salt);
    const hexKey = key.toString('hex');

    // 3. Open and configure
    const db = await openDatabase(vaultPath);

    try {
      await dbRun(db, `PRAGMA key = "x'${hexKey}'";`);
      await dbRun(db, `PRAGMA cipher_page_size = ${SQLCIPHER_PAGE_SIZE};`);
      await dbRun(db, `PRAGMA kdf_iter = 0;`);
      await dbRun(db, `PRAGMA foreign_keys = ON;`);

      // 4. Verify the key is correct by reading a table
      await dbGet(db, `SELECT count(*) AS cnt FROM hosts;`);

      // 4a. Run lightweight schema migrations for older vaults
      await runMigrations(db);
    } catch (err: unknown) {
      zeroBuffer(key);
      await closeDatabase(db).catch(() => {});

      // SQLCipher returns SQLITE_NOTADB (26) when the key is wrong
      const message =
        err instanceof Error ? err.message : String(err);
      if (
        message.includes('SQLITE_NOTADB') ||
        message.includes('file is not a database') ||
        message.includes('not a database')
      ) {
        throw new Error('Wrong password');
      }
      throw err;
    }

    // 5. Store state
    this.db = db;
    this.dbKey = key;
    this.vaultPath = vaultPath;
    this.cachedPassword = password;

    this.notifyUnlocked();
  }

  // -----------------------------------------------------------------------
  // Lock — close DB and zero key material
  // -----------------------------------------------------------------------
  lock(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Best-effort close
      }
      this.db = null;
    }

    this.cachedPassword = null;

    if (this.dbKey) {
      zeroBuffer(this.dbKey);
      this.dbKey = null;
    }

    this.vaultPath = null;
  }

  // -----------------------------------------------------------------------
  // State queries
  // -----------------------------------------------------------------------
  isUnlocked(): boolean {
    return this.db !== null;
  }

  getDb(): Database {
    if (!this.db) {
      throw new Error('Vault is locked');
    }
    return this.db;
  }

  getVaultPath(): string | null {
    return this.vaultPath;
  }

  getDbKey(): Buffer | null {
    return this.dbKey;
  }

  /**
   * Return the master password used to unlock the current vault.
   * Kept in memory for sync operations that need to re-open the vault
   * after replacing the .db file on disk. Cleared on lock.
   */
  getCurrentPassword(): string | null {
    return this.cachedPassword;
  }

  // -----------------------------------------------------------------------
  // Destroy — full cleanup
  // -----------------------------------------------------------------------
  destroy(): void {
    this.lock();
  }
}

// Singleton export
export const vaultEngine = new VaultEngine();
