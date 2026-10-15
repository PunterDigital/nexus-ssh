import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, utils } from 'ssh2';
import type {
  HostKeyPrompt,
  HostKeyVerification,
  KnownHost,
} from '../../src/shared/types';
import { startTestServer, type TestServer } from '../fixtures/ssh-server';

// The known_hosts table and the IPC layer are faked; the SSH handshake is real (ssh2 client
// against the throwaway test server), so this catches a verifier that ssh2 doesn't wait for.
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

const { checkHostKey, createHostVerifier, fingerprint, hostKeyPrompter, keyType } =
  await import('../../src/main/ssh/host-key');
const { IPC } = await import('../../src/shared/constants');

let prompts: HostKeyPrompt[] = [];
let dismissed: string[] = [];
/** What the "user" answers; null leaves the prompt open. */
let answer: HostKeyVerification | null = 'reject';

const respond = (id: string, a: HostKeyVerification) =>
  fake.handlers.get(IPC.SSH_HOST_KEY_RESPONSE)!(null, id, a);

hostKeyPrompter.setMainWindow({
  isDestroyed: () => false,
  webContents: {
    send: (channel: string, payload: unknown) => {
      if (channel === IPC.SSH_HOST_KEY_DISMISS) dismissed.push(payload as string);
      if (channel !== IPC.SSH_HOST_KEY_PROMPT) return;
      const prompt = payload as HostKeyPrompt;
      prompts.push(prompt);
      const a = answer;
      if (a) setTimeout(() => respond(prompt.id, a), 10);
    },
  },
} as never);
hostKeyPrompter.registerHandlers();

const publicKeyBlob = () =>
  Buffer.from(utils.generateKeyPairSync('ed25519').public.split(' ')[1], 'base64');

let server: TestServer;
let root: string;

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'nexus-hostkey-'));
  server = await startTestServer({ root });
});

afterAll(async () => {
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  prompts = [];
  dismissed = [];
  fake.known.length = 0;
  answer = 'reject';
});

function connect(onReady?: () => void): {
  result: Promise<'ready' | Error>;
  client: Client;
} {
  const client = new Client();
  const hostKey = createHostVerifier(server.host, server.port);
  const result = new Promise<'ready' | Error>((resolve) => {
    client.on('ready', () => {
      onReady?.();
      client.end();
      resolve('ready');
    });
    client.on('error', (err) => {
      hostKey.dismiss();
      resolve(err);
    });
  });
  client.connect({
    host: server.host,
    port: server.port,
    username: server.username,
    password: server.password,
    readyTimeout: 10_000,
    hostVerifier: hostKey.hostVerifier,
  });
  return { result, client };
}

describe('host-key verification over a real SSH handshake', () => {
  it('asks about an unknown host and refuses the connection when rejected', async () => {
    expect(await connect().result).toBeInstanceOf(Error);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({
      hostname: server.host,
      port: server.port,
      status: 'new',
      keyType: 'ssh-ed25519',
    });
    expect(prompts[0].fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    expect(fake.known).toHaveLength(0);
  });

  it('waits for the answer before the connection is ready', async () => {
    answer = null;
    let ready = false;
    const { result } = connect(() => (ready = true));
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 300));
    expect(ready).toBe(false);
    respond(prompts[0].id, 'accept');
    expect(await result).toBe('ready');
  });

  it('"Accept Once" connects without remembering the key', async () => {
    answer = 'accept';
    expect(await connect().result).toBe('ready');
    expect(fake.known).toHaveLength(0);
    expect(await connect().result).toBe('ready');
    expect(prompts).toHaveLength(2);
  });

  it('"Always Accept" stores the key, and the next connection does not ask', async () => {
    answer = 'always';
    expect(await connect().result).toBe('ready');
    expect(fake.known).toHaveLength(1);
    expect(fake.known[0]).toMatchObject({
      hostname: server.host,
      port: server.port,
      key_type: 'ssh-ed25519',
    });
    answer = 'reject';
    expect(await connect().result).toBe('ready');
    expect(prompts).toHaveLength(1);
  });

  it('warns about a changed key even though the old key was trusted', async () => {
    fake.known.push({
      id: 'old',
      hostname: server.host,
      port: server.port,
      key_type: 'ssh-ed25519',
      public_key: publicKeyBlob().toString('base64'),
      first_seen: '',
      last_seen: '',
      trusted: true,
    });
    expect(await connect().result).toBeInstanceOf(Error);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].status).toBe('changed');
  });

  it('dismissing an open prompt closes it in the renderer and refuses the key', async () => {
    answer = null;
    const { result } = connect();
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    hostKeyPrompter.dismiss(prompts[0].id);
    expect(dismissed).toEqual([prompts[0].id]);
    expect(await result).toBeInstanceOf(Error);
  });
});

describe('checkHostKey', () => {
  const key = publicKeyBlob();
  const setup = (known: Partial<KnownHost>[], a: HostKeyVerification) => {
    const ask = vi.fn(async () => a);
    const remember = vi.fn(async () => {});
    return {
      ask,
      remember,
      deps: { findKnownHosts: async () => known as KnownHost[], ask, remember },
    };
  };

  it('connects silently on a trusted match', async () => {
    const s = setup([{ public_key: key.toString('base64'), trusted: true }], 'reject');
    expect(await checkHostKey('h', 22, key, s.deps)).toBe(true);
    expect(s.ask).not.toHaveBeenCalled();
  });

  it('asks again when the matching entry has been untrusted', async () => {
    const s = setup([{ public_key: key.toString('base64'), trusted: false }], 'reject');
    expect(await checkHostKey('h', 22, key, s.deps)).toBe(false);
    expect(s.ask).toHaveBeenCalledWith(expect.objectContaining({ status: 'changed' }));
    expect(s.remember).not.toHaveBeenCalled();
  });

  it('reads the key type and an OpenSSH-style fingerprint', () => {
    expect(keyType(key)).toBe('ssh-ed25519');
    expect(keyType(Buffer.from([0, 0]))).toBe('unknown');
    expect(fingerprint(key)).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  });
});
