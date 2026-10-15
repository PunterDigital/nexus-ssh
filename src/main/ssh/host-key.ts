/**
 * Host-key verification (trust on first use).
 *
 * Every SSH connection we open checks the server's key against the vault's known_hosts.
 * A trusted match connects straight away; an unknown or changed key asks the user in the
 * renderer and waits for the answer. ssh2 needs the callback form of `hostVerifier`:
 * whatever a verifier *returns* is passed to `verify()`, so returning a Promise (truthy)
 * would accept every key.
 */

import crypto from 'node:crypto';
import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { IPC } from '../../shared/constants';
import type { HostKeyPrompt, HostKeyVerification, KnownHost } from '../../shared/types';
import * as crud from '../vault/crud';

/** SHA-256 fingerprint in OpenSSH's format, e.g. `SHA256:abc…=`. */
export function fingerprint(key: Buffer): string {
  const hash = crypto
    .createHash('sha256')
    .update(key)
    .digest('base64')
    .replace(/=+$/, '');
  return `SHA256:${hash}`;
}

/** Key type from the SSH wire format (uint32 length + name), e.g. `ssh-ed25519`. */
export function keyType(key: Buffer): string {
  try {
    const len = key.readUInt32BE(0);
    const name = key.subarray(4, 4 + len).toString('ascii');
    return /^[\w@.-]+$/.test(name) ? name : 'unknown';
  } catch {
    return 'unknown';
  }
}

export interface HostKeyDeps {
  findKnownHosts: (hostname: string, port: number) => Promise<KnownHost[]>;
  ask: (prompt: Omit<HostKeyPrompt, 'id'>) => Promise<HostKeyVerification>;
  remember: (entry: {
    hostname: string;
    port: number;
    key_type: string;
    public_key: string;
  }) => Promise<unknown>;
}

/** Decide whether to trust `key` for hostname:port. Resolves true to connect. */
export async function checkHostKey(
  hostname: string,
  port: number,
  key: Buffer,
  deps: HostKeyDeps
): Promise<boolean> {
  const publicKey = key.toString('base64');
  const known = await deps.findKnownHosts(hostname, port);
  if (known.some((kh) => kh.trusted && kh.public_key === publicKey)) return true;

  const type = keyType(key);
  const answer = await deps.ask({
    hostname,
    port,
    keyType: type,
    fingerprint: fingerprint(key),
    status: known.length > 0 ? 'changed' : 'new',
  });

  if (answer === 'always') {
    await deps.remember({ hostname, port, key_type: type, public_key: publicKey });
    return true;
  }
  return answer === 'accept';
}

// ---------------------------------------------------------------------------
// Prompting the renderer
// ---------------------------------------------------------------------------

class HostKeyPrompter {
  private mainWindow: BrowserWindow | null = null;
  private pending = new Map<string, (answer: HostKeyVerification) => void>();

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
  }

  registerHandlers(): void {
    ipcMain.handle(
      IPC.SSH_HOST_KEY_RESPONSE,
      (_event, id: string, answer: HostKeyVerification) => {
        this.settle(id, answer === 'accept' || answer === 'always' ? answer : 'reject');
        return { success: true, data: null };
      }
    );
  }

  /** Show the prompt; resolves with the user's answer ('reject' if there is no window). */
  ask(prompt: Omit<HostKeyPrompt, 'id'>): {
    id: string;
    answer: Promise<HostKeyVerification>;
  } {
    const id = uuidv4();
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) return { id, answer: Promise.resolve('reject') };

    const answer = new Promise<HostKeyVerification>((resolve) =>
      this.pending.set(id, resolve)
    );
    win.webContents.send(IPC.SSH_HOST_KEY_PROMPT, {
      ...prompt,
      id,
    } satisfies HostKeyPrompt);
    return { id, answer };
  }

  /** Close a prompt nobody needs any more (the connection failed or timed out). */
  dismiss(id: string): void {
    if (!this.pending.has(id)) return;
    this.settle(id, 'reject');
    const win = this.mainWindow;
    if (win && !win.isDestroyed()) win.webContents.send(IPC.SSH_HOST_KEY_DISMISS, id);
  }

  private settle(id: string, answer: HostKeyVerification): void {
    const resolve = this.pending.get(id);
    this.pending.delete(id);
    resolve?.(answer);
  }
}

export const hostKeyPrompter = new HostKeyPrompter();

/**
 * A `hostVerifier` for ssh2's connect config, backed by the vault's known_hosts and the
 * renderer prompt. Call `dismiss()` when the connection ends before the user answered.
 */
export function createHostVerifier(hostname: string, port: number) {
  let promptId: string | null = null;
  let rejected = false;

  const deps: HostKeyDeps = {
    findKnownHosts: crud.findKnownHost,
    remember: crud.upsertKnownHost,
    ask: (prompt) => {
      const { id, answer } = hostKeyPrompter.ask(prompt);
      promptId = id;
      return answer.finally(() => {
        promptId = null;
      });
    },
  };

  return {
    // Callback form: returns undefined, so ssh2 waits for verify().
    hostVerifier: (key: Buffer, verify: (valid: boolean) => void): void => {
      checkHostKey(hostname, port, key, deps).then(
        (ok) => {
          rejected = !ok;
          verify(ok);
        },
        () => {
          rejected = true;
          verify(false);
        }
      );
    },
    /** True once the host key was refused (by the user or because the check failed). */
    get rejected() {
      return rejected;
    },
    dismiss: () => {
      if (promptId) hostKeyPrompter.dismiss(promptId);
    },
  };
}
