import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  pullRefusal,
  type SyncVault,
  type VaultFileInfo,
} from '../../src/main/sync/pull-check';
import { sameRemoteFile, syncEngine } from '../../src/main/sync/engine';

// #5611: a pull used to delete the local vault, rename the download in and only then try to
// open it. Garbage in the sync location wiped the vault; an older genuine copy rolled it
// back. These tests drive the real sync engine and the filesystem backend; the vault is a
// fake whose "database" is JSON (the SQLCipher side is covered by sync-pull.spec.ts).

interface FakeVaultFile {
  password: string;
  createdAt: string;
  generation: number;
  hosts: string[];
}

const PASSWORD = 'correct horse';

class FakeVault {
  openPath: string | null = null;
  password: string | null = null;
  /** Make the next unlock fail, as if the swapped-in file were unreadable. */
  failNextUnlock = false;

  read(dbPath: string): FakeVaultFile {
    return JSON.parse(readFileSync(dbPath, 'utf8')) as FakeVaultFile;
  }

  adapter(): ReturnType<typeof syncEngine.vault> {
    return {
      passwordFor: (dbPath) => (this.openPath === dbPath ? this.password : null),
      localInfo: async () => this.info(this.read(this.openPath!)),
      inspect: async (dbPath, _salt, password) => {
        const file = this.read(dbPath); // throws on garbage
        if (file.password !== password) throw new Error('file is not a database');
        return this.info(file);
      },
      lock: () => {
        this.openPath = null;
        this.password = null;
      },
      unlock: async (dbPath, password) => {
        if (this.failNextUnlock) {
          this.failNextUnlock = false;
          throw new Error('file is not a database');
        }
        if (this.read(dbPath).password !== password) throw new Error('Wrong password');
        this.openPath = dbPath;
        this.password = password;
      },
      bumpGenerationIfOpen: async (dbPath) => {
        if (this.openPath !== dbPath) return;
        const file = this.read(dbPath);
        writeFileSync(
          dbPath,
          JSON.stringify({ ...file, generation: file.generation + 1 })
        );
      },
    } satisfies SyncVault & { bumpGenerationIfOpen(p: string): Promise<void> };
  }

  private info(file: FakeVaultFile): VaultFileInfo {
    return { createdAt: file.createdAt, generation: file.generation };
  }
}

describe('pullRefusal', () => {
  const info = (createdAt: string | null, generation: number): VaultFileInfo => ({
    createdAt,
    generation,
  });

  it('accepts the same vault at the same or a newer generation', () => {
    expect(pullRefusal(info('A', 3), info('A', 3))).toBeNull();
    expect(pullRefusal(info('A', 3), info('A', 4))).toBeNull();
  });

  it('refuses an older copy', () => {
    expect(pullRefusal(info('A', 5), info('A', 4))).toMatch(
      /older copy \(sync version 4, this device has 5\)/
    );
  });

  it('refuses a different vault once this one has synced', () => {
    expect(pullRefusal(info('A', 1), info('B', 9))).toMatch(/different vault/);
  });

  it('lets a vault that never synced adopt the remote one (second device)', () => {
    expect(pullRefusal(info('A', 0), info('B', 7))).toBeNull();
  });
});

describe('sync pull checks the download before replacing the vault', () => {
  let localDir: string;
  let remoteDir: string;
  let dbPath: string;
  let fake: FakeVault;
  const remoteDb = () => path.join(remoteDir, 'work.db');
  const remoteSalt = () => path.join(remoteDir, 'work.db.salt');
  const writeVault = (file: string, v: Partial<FakeVaultFile>) =>
    writeFileSync(
      file,
      JSON.stringify({
        password: PASSWORD,
        createdAt: 'A',
        generation: 0,
        hosts: [],
        ...v,
      })
    );

  beforeEach(async () => {
    localDir = mkdtempSync(path.join(tmpdir(), 'nexus-pull-local-'));
    remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-pull-remote-'));
    dbPath = path.join(localDir, 'work.db');
    writeVault(dbPath, { hosts: ['local-host'] });
    writeFileSync(dbPath + '.salt', 'local-salt');
    fake = new FakeVault();
    fake.openPath = dbPath;
    fake.password = PASSWORD;
    syncEngine.vault = () => fake.adapter();
    await syncEngine.configure({ type: 'filesystem', directoryPath: remoteDir });
  });

  afterEach(async () => {
    await syncEngine.disconnect();
    rmSync(localDir, { recursive: true, force: true });
    rmSync(remoteDir, { recursive: true, force: true });
  });

  const localHosts = () => fake.read(dbPath).hosts;
  const leftovers = () =>
    ['work.db.bak', 'work.db.salt.bak'].filter((f) => existsSync(path.join(localDir, f)));

  it('push bumps the generation in the copy it uploads', async () => {
    await syncEngine.push(dbPath);
    expect(fake.read(remoteDb()).generation).toBe(1);
    expect(fake.read(dbPath).generation).toBe(1);
  });

  it('refuses garbage and leaves the local vault as it was, open', async () => {
    writeFileSync(remoteDb(), 'not a vault at all');
    writeFileSync(remoteSalt(), 'x');
    await expect(syncEngine.pull(dbPath)).rejects.toThrow(
      /doesn't open with this vault's password.*not changed/
    );
    expect(localHosts()).toEqual(['local-host']);
    expect(readFileSync(dbPath + '.salt', 'utf8')).toBe('local-salt');
    expect(fake.openPath).toBe(dbPath);
    expect(leftovers()).toEqual([]);
  });

  it('refuses a vault encrypted with another password', async () => {
    writeVault(remoteDb(), { password: 'attacker', hosts: ['evil'] });
    writeFileSync(remoteSalt(), 'x');
    await expect(syncEngine.pull(dbPath)).rejects.toThrow(/doesn't open/);
    expect(localHosts()).toEqual(['local-host']);
  });

  it('refuses an older copy put back in the sync location', async () => {
    await syncEngine.push(dbPath); // generation 1 remote
    const old = readFileSync(remoteDb());
    writeVault(dbPath, { generation: 1, hosts: ['local-host', 'added later'] });
    await syncEngine.push(dbPath); // generation 2
    writeFileSync(remoteDb(), old);
    await expect(syncEngine.pull(dbPath)).rejects.toThrow(
      /older copy \(sync version 1, this device has 2\)/
    );
    expect(localHosts()).toEqual(['local-host', 'added later']);
  });

  it('refuses a different vault once this one has synced', async () => {
    await syncEngine.push(dbPath);
    writeVault(remoteDb(), { createdAt: 'B', generation: 5, hosts: ['other vault'] });
    await expect(syncEngine.pull(dbPath)).rejects.toThrow(/different vault/);
    expect(localHosts()).toEqual(['local-host']);
  });

  it('swaps in a newer copy of the same vault and keeps the old one as .bak', async () => {
    await syncEngine.push(dbPath);
    writeVault(remoteDb(), { generation: 2, hosts: ['from other device'] });
    writeFileSync(remoteSalt(), 'remote-salt');
    await syncEngine.pull(dbPath);
    expect(localHosts()).toEqual(['from other device']);
    expect(readFileSync(dbPath + '.salt', 'utf8')).toBe('remote-salt');
    expect(fake.openPath).toBe(dbPath);
    expect(fake.read(dbPath + '.bak').hosts).toEqual(['local-host']);
    expect(readFileSync(dbPath + '.salt.bak', 'utf8')).toBe('local-salt');
  });

  it('puts the backup back when the swapped-in file will not open', async () => {
    await syncEngine.push(dbPath);
    writeVault(remoteDb(), { generation: 2, hosts: ['from other device'] });
    fake.failNextUnlock = true;
    await expect(syncEngine.pull(dbPath)).rejects.toThrow(/restored from its backup/);
    expect(localHosts()).toEqual(['local-host']);
    expect(readFileSync(dbPath + '.salt', 'utf8')).toBe('local-salt');
    expect(fake.openPath).toBe(dbPath);
  });

  it('refuses to pull when the vault is not open with a password', async () => {
    fake.openPath = null;
    writeVault(remoteDb(), { generation: 2 });
    writeFileSync(remoteSalt(), 'x');
    await expect(syncEngine.pull(dbPath)).rejects.toThrow(/needs this vault unlocked/);
    expect(localHosts()).toEqual(['local-host']);
  });
});

describe('sameRemoteFile', () => {
  const at = (ms: number) => new Date(ms);
  it('matches on size and mtime, and ETag when both listings have one', () => {
    expect(sameRemoteFile({ size: 1, lastModified: at(5) }, { size: 1, lastModified: at(5) })).toBe(true);
    expect(sameRemoteFile({ size: 1, lastModified: at(5) }, { size: 2, lastModified: at(5) })).toBe(false);
    expect(sameRemoteFile({ size: 1, lastModified: at(5) }, { size: 1, lastModified: at(6) })).toBe(false);
    expect(
      sameRemoteFile({ size: 1, lastModified: at(5), etag: 'a' }, { size: 1, lastModified: at(5), etag: 'b' })
    ).toBe(false);
    expect(sameRemoteFile(null, { size: 1, lastModified: at(5) })).toBe(false);
  });
});

// #5661: every auto-sync tick downloaded the whole remote .db to hash it, and a remote_only
// pull downloaded it again.
describe('auto-sync ticks download only when the remote changed', () => {
  let localDir: string;
  let remoteDir: string;
  let dbPath: string;
  let fake: FakeVault;
  const remoteDb = () => path.join(remoteDir, 'work.db');
  let clock = Date.now() / 1000 - 3600;
  /** Another device writes the remote vault (with a new, distinct mtime). */
  const otherDeviceWrites = (v: Partial<FakeVaultFile>) => {
    writeFileSync(
      remoteDb(),
      JSON.stringify({ password: PASSWORD, createdAt: 'A', generation: 0, hosts: [], ...v })
    );
    clock += 10;
    utimesSync(remoteDb(), clock, clock);
  };

  beforeEach(async () => {
    localDir = mkdtempSync(path.join(tmpdir(), 'nexus-tick-local-'));
    remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-tick-remote-'));
    dbPath = path.join(localDir, 'work.db');
    writeFileSync(
      dbPath,
      JSON.stringify({ password: PASSWORD, createdAt: 'A', generation: 0, hosts: ['local-host'] })
    );
    writeFileSync(dbPath + '.salt', 'salt');
    fake = new FakeVault();
    fake.openPath = dbPath;
    fake.password = PASSWORD;
    syncEngine.vault = () => fake.adapter();
    await syncEngine.configure({ type: 'filesystem', directoryPath: remoteDir });
    await syncEngine.push(dbPath);
    syncEngine.downloads = 0;
  });

  afterEach(async () => {
    await syncEngine.disconnect();
    rmSync(localDir, { recursive: true, force: true });
    rmSync(remoteDir, { recursive: true, force: true });
  });

  it('an unchanged remote costs no download, tick after tick', async () => {
    for (let i = 0; i < 3; i++) expect(await syncEngine.detectConflict(dbPath)).toBe('none');
    expect(syncEngine.downloads).toBe(0);
  });

  it('a changed remote is downloaded exactly once, and the pull reuses that download', async () => {
    otherDeviceWrites({ generation: 2, hosts: ['from other device'] });
    expect(await syncEngine.detectConflict(dbPath)).toBe('remote_only');
    await syncEngine.pull(dbPath);
    expect(syncEngine.downloads).toBe(1);
    expect(fake.read(dbPath).hosts).toEqual(['from other device']);
    // No temp files left behind, and the next tick sees nothing new.
    expect(readdirSync(localDir).filter((f) => f.startsWith('.sync_'))).toEqual([]);
    expect(await syncEngine.detectConflict(dbPath)).toBe('none');
    expect(syncEngine.downloads).toBe(1);
  });

  it('a remote touched without new bytes is downloaded once, then remembered', async () => {
    clock += 10;
    utimesSync(remoteDb(), clock, clock);
    expect(await syncEngine.detectConflict(dbPath)).toBe('none');
    expect(await syncEngine.detectConflict(dbPath)).toBe('none');
    expect(syncEngine.downloads).toBe(1);
  });

  it('still reports a local-only change and a conflict as before', async () => {
    writeFileSync(
      dbPath,
      JSON.stringify({ password: PASSWORD, createdAt: 'A', generation: 1, hosts: ['edited here'] })
    );
    expect(await syncEngine.detectConflict(dbPath)).toBe('local_only');
    expect(syncEngine.downloads).toBe(0);
    otherDeviceWrites({ generation: 2, hosts: ['edited there'] });
    expect(await syncEngine.detectConflict(dbPath)).toBe('conflict');
    expect(readdirSync(localDir).filter((f) => f.startsWith('.sync_'))).toEqual([]);
  });

  it('a pull without a tick first still downloads the file itself', async () => {
    otherDeviceWrites({ generation: 2, hosts: ['from other device'] });
    await syncEngine.pull(dbPath);
    expect(syncEngine.downloads).toBe(1);
    expect(fake.read(dbPath).hosts).toEqual(['from other device']);
  });
});
