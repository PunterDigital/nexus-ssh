import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { utils } from 'ssh2';
import type { HostKeyPrompt, HostKeyVerification, KnownHost } from '../../src/shared/types';
import { startTestServer, type TestServer } from '../fixtures/ssh-server';

// Vault sync over SFTP must check the server's host key like the terminal does, but the
// background sync can't prompt: only Test Connection may ask, and "Always Accept" there pins
// the key. known_hosts and the IPC layer are faked; the SSH handshake is real.
const fake = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  known: [] as KnownHost[],
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) =>
      fake.handlers.set(channel, fn),
  },
}));
vi.mock('../../src/main/vault/crud', () => ({
  findKnownHost: async (hostname: string, port: number) =>
    fake.known.filter((k) => k.hostname === hostname && k.port === port),
  upsertKnownHost: async (e: {
    hostname: string;
    port: number;
    key_type: string;
    public_key: string;
  }) => {
    fake.known.push({
      ...e,
      id: `kh-${fake.known.length}`,
      first_seen: '',
      last_seen: '',
      trusted: true,
    });
  },
}));

const { hostKeyPrompter } = await import('../../src/main/ssh/host-key');
const { SFTPSyncBackend } = await import('../../src/main/sync/backends/sftp');
const { IPC } = await import('../../src/shared/constants');

let prompts: HostKeyPrompt[] = [];
let answer: HostKeyVerification = 'reject';

hostKeyPrompter.setMainWindow({
  isDestroyed: () => false,
  webContents: {
    send: (channel: string, payload: unknown) => {
      if (channel !== IPC.SSH_HOST_KEY_PROMPT) return;
      const prompt = payload as HostKeyPrompt;
      prompts.push(prompt);
      const a = answer;
      setTimeout(() => fake.handlers.get(IPC.SSH_HOST_KEY_RESPONSE)!(null, prompt.id, a), 10);
    },
  },
} as never);
hostKeyPrompter.registerHandlers();

let server: TestServer;
let remoteDir: string;
let localDir: string;

beforeAll(async () => {
  remoteDir = mkdtempSync(path.join(tmpdir(), 'nexus-sftp-sync-remote-'));
  localDir = mkdtempSync(path.join(tmpdir(), 'nexus-sftp-sync-local-'));
  server = await startTestServer({ root: remoteDir });
});

afterAll(async () => {
  await server.close();
  rmSync(remoteDir, { recursive: true, force: true });
  rmSync(localDir, { recursive: true, force: true });
});

beforeEach(() => {
  prompts = [];
  fake.known.length = 0;
  answer = 'reject';
});

const config = () => ({
  type: 'sftp' as const,
  host: server.host,
  port: server.port,
  username: server.username,
  password: server.password,
});

async function connect(interactive: boolean) {
  const backend = new SFTPSyncBackend();
  await backend.connect(config(), { interactive });
  return backend;
}

describe('SFTP sync backend host-key checks', () => {
  it('a background sync refuses an unknown host without prompting', async () => {
    await expect(connect(false)).rejects.toThrow(/isn't trusted yet.*Test Connection/);
    expect(prompts).toHaveLength(0);
    expect(fake.known).toHaveLength(0);
  });

  it('Test Connection prompts, and "Always Accept" pins the key for background syncs', async () => {
    answer = 'always';
    const tested = await connect(true);
    expect(await tested.testConnection()).toBe(true);
    await tested.disconnect();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ hostname: server.host, port: server.port, status: 'new' });
    expect(fake.known).toHaveLength(1);

    // The pinned key now lets a background sync round-trip, with no further prompt.
    answer = 'reject';
    const backend = await connect(false);
    const payload = randomBytes(64 * 1024);
    const source = path.join(localDir, 'vault.db');
    const dest = path.join(localDir, 'vault.back.db');
    writeFileSync(source, payload);
    await backend.upload(source, 'vault.db');
    expect((await backend.getRemoteMetadata('vault.db'))?.size).toBe(payload.length);
    await backend.download('vault.db', dest);
    expect(readFileSync(dest).equals(payload)).toBe(true);
    await backend.disconnect();
    expect(prompts).toHaveLength(1);
  });

  it('a background sync refuses a changed key without prompting', async () => {
    fake.known.push({
      id: 'old',
      hostname: server.host,
      port: server.port,
      key_type: 'ssh-ed25519',
      public_key: utils.generateKeyPairSync('ed25519').public.split(' ')[1],
      first_seen: '',
      last_seen: '',
      trusted: true,
    });
    await expect(connect(false)).rejects.toThrow(/has changed/);
    expect(prompts).toHaveLength(0);
  });

  it('Test Connection fails when the user rejects the key', async () => {
    await expect(connect(true)).rejects.toThrow(/was not accepted/);
    expect(prompts).toHaveLength(1);
    expect(fake.known).toHaveLength(0);
  });
});
