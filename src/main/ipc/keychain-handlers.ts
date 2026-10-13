// ============================================================
// Nexus SSH Client — Keychain IPC Handlers
// ============================================================

import { ipcMain } from 'electron';
import { IPC } from '../../shared/constants';
import { keychainManager } from '../keychain/index';
import * as crud from '../vault/crud';
import type { KeyGenerateOptions } from '../../shared/types';

/** Wrap a handler result in a standardised envelope. */
function ok<T>(data: T) {
  return { success: true as const, data };
}

function fail(error: string) {
  return { success: false as const, error };
}

export function registerKeychainHandlers(): void {
  // ── KEYCHAIN_LIST ───────────────────────────────────────────
  ipcMain.handle(IPC.KEYCHAIN_LIST, async (_event, vaultId: string) => {
    try {
      const keys = await crud.listSSHKeys(vaultId);
      // Return keys without private key material for the list view
      const safe = keys.map(({ private_key: _pk, passphrase: _pp, ...rest }) => rest);
      return ok(safe);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── KEYCHAIN_GENERATE ───────────────────────────────────────
  ipcMain.handle(
    IPC.KEYCHAIN_GENERATE,
    async (_event, options: KeyGenerateOptions & { vaultId: string }) => {
      try {
        const { vaultId, ...genOptions } = options;
        const sshKey = await keychainManager.generateKey(genOptions, vaultId);
        await crud.saveSSHKey(sshKey);
        // Return the key metadata without the private key
        const { private_key: _pk, passphrase: _pp, ...safe } = sshKey;
        return ok(safe);
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ── KEYCHAIN_IMPORT ─────────────────────────────────────────
  ipcMain.handle(
    IPC.KEYCHAIN_IMPORT,
    async (
      _event,
      params: {
        source: 'file' | 'clipboard';
        filePath?: string;
        content?: string;
        name: string;
        passphrase?: string;
        vaultId: string;
      },
    ) => {
      try {
        if (!params?.vaultId) throw new Error('vaultId is required');
        if (!params.name?.trim()) throw new Error('name is required');

        let sshKey;
        if (params.source === 'file') {
          if (!params.filePath) throw new Error('filePath is required for file import');
          sshKey = await keychainManager.importKeyFromFile({
            name: params.name.trim(),
            filePath: params.filePath,
            vaultId: params.vaultId,
            passphrase: params.passphrase,
          });
        } else if (params.source === 'clipboard') {
          if (!params.content?.trim()) {
            throw new Error('content is required for clipboard import');
          }
          sshKey = await keychainManager.importKey({
            name: params.name.trim(),
            privateKeyContent: params.content,
            vaultId: params.vaultId,
            passphrase: params.passphrase,
          });
        } else {
          throw new Error(`Unknown import source: ${params.source}`);
        }

        await crud.saveSSHKey(sshKey);
        const { private_key: _pk, passphrase: _pp, ...safe } = sshKey;
        return ok(safe);
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ── KEYCHAIN_DELETE ─────────────────────────────────────────
  ipcMain.handle(IPC.KEYCHAIN_DELETE, async (_event, keyId: string) => {
    try {
      await crud.deleteSSHKey(keyId);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── KEYCHAIN_GET_PUBLIC ─────────────────────────────────────
  ipcMain.handle(IPC.KEYCHAIN_GET_PUBLIC, async (_event, keyId: string) => {
    try {
      const key = await crud.getSSHKey(keyId);
      if (!key) throw new Error(`SSH key not found: ${keyId}`);
      return ok(key.public_key);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── KEYCHAIN_GET_FULL ───────────────────────────────────────
  // Returns the full key including private key material — only used
  // when the user explicitly requests to view/export it.
  ipcMain.handle(IPC.KEYCHAIN_GET_FULL, async (_event, keyId: string) => {
    try {
      const key = await crud.getSSHKey(keyId);
      if (!key) throw new Error(`SSH key not found: ${keyId}`);
      return ok(key);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── KEYCHAIN_EXPORT_PUBLIC ──────────────────────────────────
  ipcMain.handle(IPC.KEYCHAIN_EXPORT_PUBLIC, async (_event, keyId: string) => {
    try {
      const key = await crud.getSSHKey(keyId);
      if (!key) throw new Error(`SSH key not found: ${keyId}`);
      return ok(key.public_key);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });
}
