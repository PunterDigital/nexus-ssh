// ============================================================
// Nexus SSH Client — SSH IPC Handlers
// ============================================================

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { IPC } from '../../shared/constants';
import { sshManager, HANDSHAKE_TIMEOUT_MS } from '../ssh/index';
import { createHostVerifier, hostKeyPrompter } from '../ssh/host-key';
import * as crud from '../vault/crud';

/** Wrap a handler result in a standardised envelope. */
function ok<T>(data: T) {
  return { success: true as const, data };
}

function fail(error: string) {
  return { success: false as const, error };
}

export function registerSSHHandlers(): void {
  // Answers from the host-key prompt (SSH_HOST_KEY_RESPONSE)
  hostKeyPrompter.registerHandlers();

  // ── SSH_CONNECT ─────────────────────────────────────────────
  ipcMain.handle(IPC.SSH_CONNECT, async (_event, hostId: string) => {
    try {
      // 1. Resolve credentials from the vault (walks group inheritance)
      const credentials = await crud.resolveCredentials(hostId);

      // 2. Load host metadata for label/colour
      const host = await crud.getHost(hostId);
      if (!host) throw new Error(`Host not found: ${hostId}`);

      // 3. Generate a unique session ID
      const sessionId = uuidv4();

      // 4. Connect (verifies the host key against known_hosts / asks the user)
      await sshManager.connect({
        sessionId,
        hostId,
        label: host.label,
        colour: host.colour,
        credentials,
        cols: 80,
        rows: 24,
      });

      // 5. Update last_connected timestamp
      await crud.updateLastConnected(hostId);

      return ok(sessionId);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── SSH_TEST_CONNECT ────────────────────────────────────────
  // Quick test with raw credentials — no saved host required
  ipcMain.handle(
    IPC.SSH_TEST_CONNECT,
    async (
      _event,
      opts: {
        hostname: string;
        port: number;
        username: string;
        password?: string;
        keyId?: string;
      },
    ) => {
      const { Client } = require('ssh2');

      // Resolve key material from the vault if a keyId was provided
      let privateKey: string | undefined;
      let passphrase: string | undefined;
      if (opts.keyId) {
        try {
          const sshKey = await crud.getSSHKey(opts.keyId);
          if (!sshKey) {
            return fail('SSH key not found in vault');
          }
          privateKey = sshKey.private_key;
          passphrase = sshKey.passphrase || undefined;
        } catch (err: unknown) {
          return fail(
            err instanceof Error ? err.message : 'Failed to load SSH key',
          );
        }
      }

      return new Promise((resolve) => {
        const client = new Client();
        const hostKey = createHostVerifier(opts.hostname, opts.port);
        const timer = setTimeout(() => {
          hostKey.dismiss();
          try { client.end(); } catch { /* ignore */ }
          resolve(fail('Connection timed out'));
        }, HANDSHAKE_TIMEOUT_MS);

        client.on('ready', () => {
          clearTimeout(timer);
          client.end();
          resolve(ok('Connection successful'));
        });

        client.on('error', (err: Error) => {
          clearTimeout(timer);
          hostKey.dismiss();
          resolve(fail(hostKey.rejected ? 'Host key was not trusted' : err.message));
        });

        const connectConfig: Record<string, unknown> = {
          host: opts.hostname,
          port: opts.port,
          username: opts.username,
          readyTimeout: HANDSHAKE_TIMEOUT_MS,
          tryKeyboard: true,
          hostVerifier: hostKey.hostVerifier,
        };
        if (privateKey) {
          connectConfig.privateKey = privateKey;
          if (passphrase) connectConfig.passphrase = passphrase;
        }
        if (opts.password) {
          connectConfig.password = opts.password;
        }

        try {
          client.connect(connectConfig);
        } catch (err: unknown) {
          clearTimeout(timer);
          resolve(fail(err instanceof Error ? err.message : String(err)));
        }
      });
    },
  );

  // ── SSH_DISCONNECT ──────────────────────────────────────────
  ipcMain.handle(IPC.SSH_DISCONNECT, async (_event, sessionId: string) => {
    try {
      sshManager.disconnect(sessionId);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── SSH_WRITE ───────────────────────────────────────────────
  ipcMain.handle(IPC.SSH_WRITE, async (_event, sessionId: string, data: string) => {
    try {
      sshManager.write(sessionId, data);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── SSH_RESIZE ──────────────────────────────────────────────
  ipcMain.handle(IPC.SSH_RESIZE, async (_event, sessionId: string, cols: number, rows: number) => {
    try {
      sshManager.resize(sessionId, cols, rows);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── SSH_MARK_READY ──────────────────────────────────────────
  // Renderer calls this once the xterm instance has mounted so that
  // any buffered PTY output gets flushed back.
  ipcMain.handle(IPC.SSH_MARK_READY, async (_event, sessionId: string) => {
    try {
      const buffered = sshManager.markRendererReady(sessionId);
      return ok(buffered);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── SSH_LIST_SESSIONS ───────────────────────────────────────
  ipcMain.handle(IPC.SSH_LIST_SESSIONS, async () => {
    try {
      return ok(sshManager.listSessions());
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });
}
