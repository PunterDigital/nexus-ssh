import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { HostKeyPrompt, HostKeyVerification, UpdateStatus } from '../shared/types';

/**
 * Nexus preload script.
 * Exposes a controlled API surface to the renderer via contextBridge.
 * All methods are thin wrappers around ipcRenderer.invoke.
 *
 * IPC handlers return { success: boolean, data?, error? } envelopes.
 * The `call` helper unwraps them so the renderer gets clean values.
 */

async function call<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (result && typeof result === 'object' && 'success' in result) {
    if (!result.success) {
      throw new Error(result.error || 'Unknown error');
    }
    return result.data as T;
  }
  return result as T;
}

const nexusAPI = {
  // ── Vault ──────────────────────────────────────────────────
  vault: {
    create: (password: string, name?: string) =>
      call('vault:create', password, name),
    unlock: (password: string, vaultPath?: string) =>
      call('vault:unlock', password, vaultPath),
    lock: () =>
      call('vault:lock'),
    isUnlocked: () =>
      call<boolean>('vault:isUnlocked'),
    exists: () =>
      call<boolean>('vault:exists'),
    list: () =>
      call<string[]>('vault:list'),
    /** Lock the open vault and close every SSH/SFTP session, ready to open another vault. */
    switch: () =>
      call('vault:switch'),
    /** Path of the unlocked vault, or null when locked. */
    current: () =>
      call<string | null>('vault:current'),
    changePassword: (oldPassword: string, newPassword: string) =>
      call('vault:change-password', oldPassword, newPassword),
  },

  // ── Hardware key (FIDO2/WebAuthn PRF) ─────────────────────
  hardwareKey: {
    has: (vaultPath: string) => call<boolean>('hwkey:has', vaultPath),
    getInfo: (vaultPath: string) =>
      call<{
        credentialId: string;
        prfSalt: string;
        rpId: string;
        userHandle: string;
        passwordless: boolean;
      }>('hwkey:get-info', vaultPath),
    setup: (payload: {
      credentialId: string;
      prfSalt: string;
      prfOutput: string;
      rpId: string;
      userHandle: string;
    }) => call('hwkey:setup', payload),
    createPasswordless: (payload: {
      name?: string;
      credentialId: string;
      prfSalt: string;
      prfOutput: string;
      rpId: string;
      userHandle: string;
    }) => call<string>('hwkey:create-passwordless', payload),
    unlock: (payload: { vaultPath: string; prfOutput: string }) =>
      call<string>('hwkey:unlock', payload),
    remove: (vaultPath: string) => call('hwkey:remove', vaultPath),
  },

  // ── CRUD ──────────────────────────────────────────────────
  vaults: {
    list: () => call('vaults:list'),
    create: (data: unknown) => call('vaults:create', data),
    update: (id: string, data: unknown) => call('vaults:update', id, data),
    delete: (id: string) => call('vaults:delete', id),
  },
  groups: {
    list: (vaultId: string) => call('groups:list', vaultId),
    create: (data: unknown) => call('groups:create', data),
    update: (id: string, data: unknown) => call('groups:update', id, data),
    delete: (id: string) => call('groups:delete', id),
  },
  hosts: {
    list: (vaultId: string) => call('hosts:list', vaultId),
    get: (id: string) => call('hosts:get', id),
    create: (data: unknown) => call('hosts:create', data),
    update: (id: string, data: unknown) => call('hosts:update', id, data),
    delete: (id: string) => call('hosts:delete', id),
    resolveCredentials: (hostId: string) => call('hosts:resolve-credentials', hostId),
  },
  identities: {
    list: (vaultId: string) => call('identities:list', vaultId),
    create: (data: unknown) => call('identities:create', data),
    update: (id: string, data: unknown) => call('identities:update', id, data),
    delete: (id: string) => call('identities:delete', id),
  },
  tags: {
    list: () => call('tags:list'),
    create: (data: unknown) => call('tags:create', data),
    update: (id: string, data: unknown) => call('tags:update', id, data),
    delete: (id: string) => call('tags:delete', id),
    setHostTags: (hostId: string, tagIds: string[]) => call('host-tags:set', hostId, tagIds),
    getHostTags: (hostId: string) => call('host-tags:get', hostId),
  },
  knownHosts: {
    list: () => call('known-hosts:list'),
    delete: (id: string) => call('known-hosts:delete', id),
    trust: (id: string, trusted: boolean) => call('known-hosts:trust', id, trusted),
  },

  // ── SSH ────────────────────────────────────────────────────
  ssh: {
    connect: (hostId: string) =>
      call('ssh:connect', hostId),
    testConnect: (opts: { hostname: string; port: number; username: string; password?: string; keyId?: string }) =>
      call('ssh:test-connect', opts),
    markReady: (sessionId: string) => call<string>('ssh:mark-ready', sessionId),
    disconnect: (sessionId: string) =>
      call('ssh:disconnect', sessionId),
    write: (sessionId: string, data: string) =>
      call('ssh:write', sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      call('ssh:resize', sessionId, cols, rows),
    listSessions: () =>
      call('ssh:list-sessions'),
    onData: (callback: (sessionId: string, data: string) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { sessionId: string; data: string },
      ) => callback(payload.sessionId, payload.data);
      ipcRenderer.on('ssh:data', listener);
      return () => {
        ipcRenderer.removeListener('ssh:data', listener);
      };
    },
    onClose: (callback: (sessionId: string, code: number) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { sessionId: string; error?: string },
      ) => callback(payload.sessionId, payload.error ? 1 : 0);
      ipcRenderer.on('ssh:close', listener);
      return () => {
        ipcRenderer.removeListener('ssh:close', listener);
      };
    },
    // Host-key verification: main asks, the renderer answers with the prompt's id.
    onHostKeyPrompt: (callback: (prompt: HostKeyPrompt) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, prompt: HostKeyPrompt) => callback(prompt);
      ipcRenderer.on('ssh:host-key-prompt', listener);
      return () => {
        ipcRenderer.removeListener('ssh:host-key-prompt', listener);
      };
    },
    onHostKeyDismiss: (callback: (id: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, id: string) => callback(id);
      ipcRenderer.on('ssh:host-key-dismiss', listener);
      return () => {
        ipcRenderer.removeListener('ssh:host-key-dismiss', listener);
      };
    },
    respondHostKey: (id: string, answer: HostKeyVerification) =>
      call('ssh:host-key-response', id, answer),
  },

  // ── SFTP ───────────────────────────────────────────────────
  sftp: {
    list: (sessionId: string, remotePath: string) =>
      call('sftp:list', sessionId, remotePath),
    upload: (sessionId: string, localPath: string, remotePath: string) =>
      call('sftp:upload', sessionId, localPath, remotePath),
    download: (sessionId: string, remotePath: string, localPath: string) =>
      call('sftp:download', sessionId, remotePath, localPath),
    mkdir: (sessionId: string, remotePath: string) =>
      call('sftp:mkdir', sessionId, remotePath),
    delete: (sessionId: string, remotePath: string) =>
      call('sftp:delete', sessionId, remotePath),
    rename: (sessionId: string, oldPath: string, newPath: string) =>
      call('sftp:rename', sessionId, oldPath, newPath),
    stat: (sessionId: string, remotePath: string) =>
      call('sftp:stat', sessionId, remotePath),
    chmod: (sessionId: string, remotePath: string, mode: string) =>
      call('sftp:chmod', sessionId, remotePath, mode),
    pauseTransfer: (transferId: string) => call('sftp:transfer-pause', transferId),
    resumeTransfer: (transferId: string) => call('sftp:transfer-resume', transferId),
    cancelTransfer: (transferId: string) => call('sftp:transfer-cancel', transferId),
    onTransferProgress: (callback: (progress: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: unknown) =>
        callback(progress);
      ipcRenderer.on('sftp:transfer-progress', listener);
      return () => {
        ipcRenderer.removeListener('sftp:transfer-progress', listener);
      };
    },
  },

  // ── Keychain ───────────────────────────────────────────────
  keychain: {
    listKeys: (vaultId: string) =>
      call('keychain:list', vaultId),
    generateKey: (options: unknown) =>
      call('keychain:generate', options),
    importKey: (params: unknown) =>
      call('keychain:import', params),
    exportPublicKey: (keyId: string) =>
      call('keychain:export-public', keyId),
    deleteKey: (keyId: string) =>
      call('keychain:delete', keyId),
    getPublicKey: (keyId: string) =>
      call('keychain:get-public', keyId),
    getFullKey: (keyId: string) =>
      call('keychain:get-full', keyId),
  },

  // ── Sync ───────────────────────────────────────────────────
  sync: {
    configure: (config: unknown) =>
      call('sync:configure', config),
    getConfig: () =>
      call('sync:get-config'),
    push: () =>
      call('sync:push'),
    pull: () =>
      call('sync:pull'),
    getStatus: () =>
      call('sync:get-status'),
    setEnabled: (enabled: boolean) =>
      call('sync:set-enabled', enabled),
    testConnection: (config: unknown) =>
      call<boolean>('sync:test-connection', config),
    onSyncStatus: (callback: (status: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: unknown) =>
        callback(status);
      ipcRenderer.on('sync:status-update', listener);
      return () => {
        ipcRenderer.removeListener('sync:status-update', listener);
      };
    },
  },

  // ── Snippets ───────────────────────────────────────────────
  snippets: {
    list: (vaultId: string) =>
      call('snippets:list', vaultId),
    create: (snippet: unknown) =>
      call('snippets:create', snippet),
    update: (id: string, snippet: unknown) =>
      call('snippets:update', id, snippet),
    delete: (id: string) =>
      call('snippets:delete', id),
    execute: (sessionId: string, snippetId: string) =>
      call('snippets:execute', sessionId, snippetId),
  },

  // ── Settings ───────────────────────────────────────────────
  settings: {
    get: (key: string) =>
      call('settings:get', key),
    set: (key: string, value: unknown) =>
      call('settings:set', key, value),
    getAll: () =>
      call('settings:get-all'),
    reset: (key: string) =>
      call('settings:reset', key),
    onChanged: (callback: (key: string, value: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, key: string, value: unknown) =>
        callback(key, value);
      ipcRenderer.on('settings:changed', listener);
      return () => {
        ipcRenderer.removeListener('settings:changed', listener);
      };
    },
  },

  // ── Clipboard ──────────────────────────────────────────────
  clipboard: {
    copySecure: (text: string) =>
      call('clipboard:copy-secure', text),
  },

  // ── External links ─────────────────────────────────────────
  shell: {
    /** Opens an allow-listed https link (repository, downloads page) in the default browser. */
    openExternal: (url: string) => call('shell:open-external', url),
  },

  // ── App-level settings (stored outside the encrypted vault) ──
  appSettings: {
    get: (key: string) => call('app-settings:get', key),
    set: (key: string, value: unknown) => call('app-settings:set', key, value),
    getAll: () => call<Record<string, unknown>>('app-settings:get-all'),
  },

  // ── App updates ────────────────────────────────────────────
  updater: {
    getStatus: () => call<UpdateStatus>('updater:get-status'),
    check: () => call<UpdateStatus>('updater:check'),
    install: () => call('updater:install'),
    openDownloads: () => call('updater:open-downloads'),
    onStatus: (callback: (status: UpdateStatus) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus) =>
        callback(status);
      ipcRenderer.on('updater:status', listener);
      return () => {
        ipcRenderer.removeListener('updater:status', listener);
      };
    },
  },

  // ── Local filesystem (for SFTP browser's local pane) ──────
  fs: {
    list: (dirPath: string) => call('fs:list', dirPath),
    home: () => call<string>('fs:home'),
    openVaultDir: () => call<string>('fs:open-vault-dir'),
    pickDirectory: () => call<string | null>('fs:pick-directory'),
    pickFile: (options?: {
      title?: string;
      filters?: { name: string; extensions: string[] }[];
    }) =>
      call<{ filePaths: string[]; canceled: boolean }>('fs:pick-file', options),
    /** Absolute path of a File from an OS drag-and-drop (File.path was removed in Electron 32). */
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  },

  // ── System events (from main → renderer) ───────────────────
  system: {
    onSuspend: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('system:suspend', listener);
      return () => {
        ipcRenderer.removeListener('system:suspend', listener);
      };
    },
    onResume: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('system:resume', listener);
      return () => {
        ipcRenderer.removeListener('system:resume', listener);
      };
    },
    onLock: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('system:lock', listener);
      return () => {
        ipcRenderer.removeListener('system:lock', listener);
      };
    },
    onUnlock: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('system:unlock', listener);
      return () => {
        ipcRenderer.removeListener('system:unlock', listener);
      };
    },
    onVaultLocked: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('security:vault-locked', listener);
      return () => {
        ipcRenderer.removeListener('security:vault-locked', listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld('nexus', nexusAPI);

// Type declaration for renderer access
export type NexusAPI = typeof nexusAPI;
