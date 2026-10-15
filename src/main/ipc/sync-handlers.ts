// ============================================================
// Nexus SSH Client — Sync IPC Handlers
// ============================================================

import { ipcMain } from 'electron';
import { IPC } from '../../shared/constants';
import { syncEngine } from '../sync/engine';
import { vaultEngine } from '../vault/index';
import * as crud from '../vault/crud';
import type { BackendConfig, SyncBackendType } from '../../shared/types';

/** Wrap a handler result in a standardised envelope. */
function ok<T>(data: T) {
  return { success: true as const, data };
}

function fail(error: string) {
  return { success: false as const, error };
}

/**
 * Make sure the sync engine has a backend configured. Reads the stored
 * sync_state from the vault DB and calls syncEngine.configure() with the
 * persisted backend config.
 */
async function ensureBackendConfigured(): Promise<void> {
  const state = await crud.getSyncState();
  if (!state || !state.backend_config) {
    throw new Error('No sync backend configured. Open Settings → Vault Sync.');
  }
  let backendConfig: BackendConfig | null = null;
  try {
    const parsed = JSON.parse(state.backend_config);
    if (parsed && typeof parsed === 'object') {
      backendConfig = parsed.backendConfig ?? parsed;
    }
  } catch {
    throw new Error('Sync configuration is corrupted. Please reconfigure.');
  }
  if (!backendConfig || !backendConfig.type) {
    throw new Error('Sync backend type is missing. Please reconfigure.');
  }
  await syncEngine.configure(backendConfig);
}

export function registerSyncHandlers(): void {
  // ── SYNC_CONFIGURE ──────────────────────────────────────────
  ipcMain.handle(
    IPC.SYNC_CONFIGURE,
    async (
      _event,
      payload: {
        backendType: string;
        backendConfig: BackendConfig;
        syncInterval?: number;
        syncOnLock?: boolean;
        syncOnLaunch?: boolean;
        conflictResolution?: string;
      },
    ) => {
      try {
        // Tell the sync engine about the backend connection details (only if
        // sufficient config — an empty config is valid during setup).
        if (payload.backendConfig && payload.backendConfig.type) {
          try {
            await syncEngine.configure(payload.backendConfig);
          } catch {
            // Ignore connect errors while the user is still editing the form
          }
        }

        // Persist the full rich configuration as JSON in backend_config so
        // nothing is lost between sessions.
        const fullConfigJson = JSON.stringify({
          backendConfig: payload.backendConfig ?? { type: payload.backendType },
          syncOnLock: payload.syncOnLock ?? true,
          syncOnLaunch: payload.syncOnLaunch ?? true,
          conflictResolution: payload.conflictResolution ?? 'ask',
        });

        await crud.upsertSyncState({
          backend_type: payload.backendType as SyncBackendType,
          backend_config: fullConfigJson,
          sync_interval: payload.syncInterval ?? 300,
        });

        return ok(null);
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ── SYNC_TEST_CONNECTION ────────────────────────────────────
  // Tests the config from the settings form without replacing the active backend.
  ipcMain.handle(IPC.SYNC_TEST_CONNECTION, async (_event, config: BackendConfig) => {
    if (!config || !config.type) {
      return fail('Choose a sync backend first.');
    }
    const backend = syncEngine.createBackend(config.type);
    try {
      // Interactive: an unknown/changed SSH host key is shown to the user, and trusting it
      // pins it for the background syncs, which never prompt.
      await backend.connect(config, { interactive: true });
      return ok(await backend.testConnection());
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    } finally {
      await backend.disconnect().catch(() => {});
    }
  });

  // ── SYNC_GET_CONFIG ─────────────────────────────────────────
  ipcMain.handle(IPC.SYNC_GET_CONFIG, async () => {
    try {
      const state = await crud.getSyncState();
      if (!state) return ok(null);

      // Unpack the JSON blob in backend_config and return the rich shape
      let backendConfig: BackendConfig = { type: state.backend_type as BackendConfig['type'] };
      let syncOnLock = true;
      let syncOnLaunch = true;
      let conflictResolution: 'ask' | 'keep_local' | 'keep_remote' = 'ask';

      try {
        const parsed = JSON.parse(state.backend_config);
        if (parsed && typeof parsed === 'object') {
          if (parsed.backendConfig) {
            backendConfig = parsed.backendConfig;
          } else if (parsed.type) {
            // Legacy format: the whole blob was a BackendConfig
            backendConfig = parsed as BackendConfig;
          }
          if (typeof parsed.syncOnLock === 'boolean') syncOnLock = parsed.syncOnLock;
          if (typeof parsed.syncOnLaunch === 'boolean') syncOnLaunch = parsed.syncOnLaunch;
          if (parsed.conflictResolution) conflictResolution = parsed.conflictResolution;
        }
      } catch {
        // Malformed JSON — fall back to defaults
      }

      return ok({
        backendType: state.backend_type,
        backendConfig,
        syncInterval: state.sync_interval,
        syncOnLock,
        syncOnLaunch,
        conflictResolution,
        enabled: state.enabled,
      });
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── SYNC_PUSH ───────────────────────────────────────────────
  ipcMain.handle(IPC.SYNC_PUSH, async () => {
    try {
      const vaultPath = vaultEngine.getVaultPath();
      if (!vaultPath) throw new Error('Vault is not unlocked');
      await ensureBackendConfigured();
      await syncEngine.push(vaultPath);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── SYNC_PULL ───────────────────────────────────────────────
  ipcMain.handle(IPC.SYNC_PULL, async () => {
    try {
      const vaultPath = vaultEngine.getVaultPath();
      if (!vaultPath) throw new Error('Vault is not unlocked');
      await ensureBackendConfigured();
      await syncEngine.pull(vaultPath);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── SYNC_GET_STATUS ─────────────────────────────────────────
  ipcMain.handle(IPC.SYNC_GET_STATUS, async () => {
    try {
      return ok(syncEngine.getStatus());
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── SYNC_SET_ENABLED ────────────────────────────────────────
  ipcMain.handle(IPC.SYNC_SET_ENABLED, async (_event, enabled: boolean) => {
    try {
      if (enabled) {
        const vaultPath = vaultEngine.getVaultPath();
        if (!vaultPath) throw new Error('Vault is not unlocked');

        // Read the stored sync interval (default to 300s if not configured)
        const state = await crud.getSyncState();
        const interval = state?.sync_interval ?? 300;

        syncEngine.startAutoSync(vaultPath, interval);
      } else {
        syncEngine.stopAutoSync();
      }

      // Persist the enabled state
      const existing = await crud.getSyncState();
      if (existing) {
        await crud.upsertSyncState({
          backend_type: existing.backend_type,
          backend_config: existing.backend_config,
          enabled,
        });
      }

      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });
}
