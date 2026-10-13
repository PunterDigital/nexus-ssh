// ============================================================
// Nexus SSH Client — CRUD IPC Handlers
// ============================================================

import { ipcMain } from 'electron';
import { IPC } from '../../shared/constants';
import * as crud from '../vault/crud';

/** Wrap a handler result in a standardised envelope. */
function ok<T>(data: T) {
  return { success: true as const, data };
}

function fail(error: string) {
  return { success: false as const, error };
}

export function registerCrudHandlers(): void {
  // ── Vaults (organisational containers) ────────────────────────

  ipcMain.handle(IPC.VAULTS_LIST, async () => {
    try {
      return ok(await crud.listVaults());
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.VAULTS_CREATE, async (_event, data: Parameters<typeof crud.createVault>[0]) => {
    try {
      return ok(await crud.createVault(data));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.VAULTS_UPDATE, async (_event, id: string, data: Parameters<typeof crud.updateVault>[1]) => {
    try {
      return ok(await crud.updateVault(id, data));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.VAULTS_DELETE, async (_event, id: string) => {
    try {
      await crud.deleteVault(id);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── Groups ────────────────────────────────────────────────────

  ipcMain.handle(IPC.GROUPS_LIST, async (_event, vaultId: string) => {
    try {
      return ok(await crud.listGroups(vaultId));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.GROUPS_CREATE, async (_event, data: Parameters<typeof crud.createGroup>[0]) => {
    try {
      return ok(await crud.createGroup(data));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.GROUPS_UPDATE, async (_event, id: string, data: Parameters<typeof crud.updateGroup>[1]) => {
    try {
      return ok(await crud.updateGroup(id, data));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.GROUPS_DELETE, async (_event, id: string) => {
    try {
      await crud.deleteGroup(id);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── Hosts ─────────────────────────────────────────────────────

  ipcMain.handle(IPC.HOSTS_LIST, async (_event, vaultId: string) => {
    try {
      return ok(await crud.listHosts(vaultId));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.HOSTS_GET, async (_event, id: string) => {
    try {
      const host = await crud.getHost(id);
      if (!host) throw new Error(`Host not found: ${id}`);
      return ok(host);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.HOSTS_CREATE, async (_event, data: Parameters<typeof crud.createHost>[0]) => {
    try {
      return ok(await crud.createHost(data));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.HOSTS_UPDATE, async (_event, id: string, data: Parameters<typeof crud.updateHost>[1]) => {
    try {
      return ok(await crud.updateHost(id, data));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.HOSTS_DELETE, async (_event, id: string) => {
    try {
      await crud.deleteHost(id);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.HOSTS_RESOLVE_CREDENTIALS, async (_event, hostId: string) => {
    try {
      return ok(await crud.resolveCredentials(hostId));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── Identities ────────────────────────────────────────────────

  ipcMain.handle(IPC.IDENTITIES_LIST, async (_event, vaultId: string) => {
    try {
      return ok(await crud.listIdentities(vaultId));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.IDENTITIES_CREATE, async (_event, data: Parameters<typeof crud.createIdentity>[0]) => {
    try {
      return ok(await crud.createIdentity(data));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.IDENTITIES_UPDATE, async (_event, id: string, data: Parameters<typeof crud.updateIdentity>[1]) => {
    try {
      return ok(await crud.updateIdentity(id, data));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.IDENTITIES_DELETE, async (_event, id: string) => {
    try {
      await crud.deleteIdentity(id);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── Tags ──────────────────────────────────────────────────────

  ipcMain.handle(IPC.TAGS_LIST, async () => {
    try {
      return ok(await crud.listTags());
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.TAGS_CREATE, async (_event, data: Parameters<typeof crud.createTag>[0]) => {
    try {
      return ok(await crud.createTag(data));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.TAGS_UPDATE, async (_event, id: string, data: Parameters<typeof crud.updateTag>[1]) => {
    try {
      return ok(await crud.updateTag(id, data));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.TAGS_DELETE, async (_event, id: string) => {
    try {
      await crud.deleteTag(id);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── Host Tags ─────────────────────────────────────────────────

  ipcMain.handle(IPC.HOST_TAGS_SET, async (_event, hostId: string, tagIds: string[]) => {
    try {
      await crud.setHostTags(hostId, tagIds);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.HOST_TAGS_GET, async (_event, hostId: string) => {
    try {
      return ok(await crud.getHostTags(hostId));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── Known Hosts ───────────────────────────────────────────────

  ipcMain.handle(IPC.KNOWN_HOSTS_LIST, async () => {
    try {
      return ok(await crud.listKnownHosts());
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.KNOWN_HOSTS_DELETE, async (_event, id: string) => {
    try {
      await crud.deleteKnownHost(id);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.KNOWN_HOSTS_TRUST, async (_event, id: string, trusted: boolean) => {
    try {
      await crud.trustKnownHost(id, trusted);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── Snippets ──────────────────────────────────────────────────

  ipcMain.handle(IPC.SNIPPETS_LIST, async (_event, vaultId: string) => {
    try {
      return ok(await crud.listSnippets(vaultId));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.SNIPPETS_CREATE, async (_event, data: Parameters<typeof crud.createSnippet>[0]) => {
    try {
      return ok(await crud.createSnippet(data));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.SNIPPETS_UPDATE, async (_event, id: string, data: Parameters<typeof crud.updateSnippet>[1]) => {
    try {
      return ok(await crud.updateSnippet(id, data));
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle(IPC.SNIPPETS_DELETE, async (_event, id: string) => {
    try {
      await crud.deleteSnippet(id);
      return ok(null);
    } catch (err: unknown) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  });
}
