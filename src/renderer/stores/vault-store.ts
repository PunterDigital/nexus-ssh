import { create } from 'zustand';
import type {
  Vault,
  Group,
  Host,
  Identity,
  Tag,
  Snippet,
  SSHKey,
} from '../../shared/types';
import * as webauthnPrf from '../lib/webauthn-prf';

// ============================================================
// Vault Store — manages vault data (hosts, groups, identities, etc.)
// ============================================================

export interface VaultState {
  // Data
  vaults: Vault[];
  groups: Group[];
  hosts: Host[];
  identities: Identity[];
  tags: Tag[];
  snippets: Snippet[];
  keys: SSHKey[];

  // Vault status
  unlocked: boolean;
  activeVaultPath: string | null;

  // UI selection tracking
  selectedHostId: string | null;
  selectedGroupId: string | null;
  selectedVaultId: string | null;

  // Loading/error
  loading: boolean;
  error: string | null;
}

export interface VaultActions {
  // Vault lifecycle
  createVault: (password: string, name?: string) => Promise<void>;
  unlockVault: (password: string, vaultPath?: string) => Promise<void>;
  lockVault: () => Promise<void>;
  /** Lock and close the vault's SSH/SFTP sessions in main, then drop the vault data here. */
  switchVault: () => Promise<void>;
  checkVaultExists: () => Promise<boolean>;

  // Hardware key (FIDO2 / WebAuthn PRF) unlock
  createPasswordlessVault: (name: string) => Promise<void>;
  unlockWithHardwareKey: (vaultPath: string) => Promise<void>;
  /** PIN quick-unlock (#2653). Errors are thrown for the PIN form to show, not kept in `error`. */
  unlockWithPin: (vaultPath: string, pin: string) => Promise<void>;
  enrollHardwareKey: (displayName: string) => Promise<void>;

  // Load all data after unlock
  loadAll: () => Promise<void>;

  // Hosts
  addHost: (host: Omit<Host, 'id' | 'created_at' | 'updated_at' | 'sort_order'>) => Promise<Host>;
  updateHost: (id: string, updates: Partial<Host>) => Promise<void>;
  deleteHost: (id: string) => Promise<void>;

  // Groups
  addGroup: (group: Omit<Group, 'id' | 'created_at' | 'updated_at' | 'sort_order'>) => Promise<Group>;
  updateGroup: (id: string, updates: Partial<Group>) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;

  // Identities
  addIdentity: (identity: Omit<Identity, 'id' | 'created_at' | 'updated_at'>) => Promise<Identity>;
  updateIdentity: (id: string, updates: Partial<Identity>) => Promise<void>;
  deleteIdentity: (id: string) => Promise<void>;

  // Tags
  addTag: (tag: Omit<Tag, 'id'>) => Promise<Tag>;
  updateTag: (id: string, updates: Partial<Tag>) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;

  // Snippets
  addSnippet: (snippet: Omit<Snippet, 'id' | 'created_at' | 'updated_at' | 'sort_order'>) => Promise<Snippet>;
  updateSnippet: (id: string, updates: Partial<Snippet>) => Promise<void>;
  deleteSnippet: (id: string) => Promise<void>;

  // Keys
  loadKeys: () => Promise<void>;

  // Selection
  setSelectedHostId: (id: string | null) => void;
  setSelectedGroupId: (id: string | null) => void;
  setSelectedVaultId: (id: string | null) => void;

  // Clear
  reset: () => void;
}

const initialState: VaultState = {
  vaults: [],
  groups: [],
  hosts: [],
  identities: [],
  tags: [],
  snippets: [],
  keys: [],
  unlocked: false,
  activeVaultPath: null,
  selectedHostId: null,
  selectedGroupId: null,
  selectedVaultId: null,
  loading: false,
  error: null,
};

export const useVaultStore = create<VaultState & VaultActions>()((set, get) => ({
  ...initialState,

  // ── Vault lifecycle ────────────────────────────────────────

  createVault: async (password: string, name?: string) => {
    set({ loading: true, error: null });
    try {
      // Backend creates the .db file and leaves the vault unlocked
      await window.nexus.vault.create(password, name);
      set({ unlocked: true, loading: false });
      await get().loadAll();
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
      throw err;
    }
  },

  unlockVault: async (password: string, vaultPath?: string) => {
    set({ loading: true, error: null });
    try {
      await window.nexus.vault.unlock(password, vaultPath);
      set({ unlocked: true, loading: false });
      await get().loadAll();
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
      throw err;
    }
  },

  lockVault: async () => {
    try {
      await window.nexus.vault.lock();
    } finally {
      get().reset();
    }
  },

  switchVault: async () => {
    // Only reset once main has locked: if the switch fails the vault stays open and usable.
    await window.nexus.vault.switch();
    get().reset();
  },

  checkVaultExists: async () => {
    return await window.nexus.vault.exists();
  },

  unlockWithPin: async (vaultPath: string, pin: string) => {
    set({ loading: true, error: null });
    try {
      await window.nexus.pin.unlock(vaultPath, pin);
    } catch (err) {
      set({ loading: false });
      throw err;
    }
    set({ unlocked: true, loading: false });
    await get().loadAll();
  },

  // ── Hardware-key unlock (FIDO2 / WebAuthn PRF) ─────────────

  createPasswordlessVault: async (name: string) => {
    set({ loading: true, error: null });
    try {
      const enroll = await webauthnPrf.enroll(name);
      await window.nexus.hardwareKey.createPasswordless({
        name,
        credentialId: enroll.credentialId,
        prfSalt: enroll.prfSalt,
        prfOutput: enroll.prfOutput,
        rpId: enroll.rpId,
        userHandle: enroll.userHandle,
      });
      set({ unlocked: true, loading: false });
      await get().loadAll();
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
      throw err;
    }
  },

  unlockWithHardwareKey: async (vaultPath: string) => {
    set({ loading: true, error: null });
    try {
      const info = await window.nexus.hardwareKey.getInfo(vaultPath);
      const assertion = await webauthnPrf.assertWithCredential({
        credentialId: info.credentialId,
        prfSalt: info.prfSalt,
        rpId: info.rpId,
      });
      await window.nexus.hardwareKey.unlock({
        vaultPath,
        prfOutput: assertion.prfOutput,
      });
      set({ unlocked: true, loading: false });
      await get().loadAll();
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
      throw err;
    }
  },

  enrollHardwareKey: async (displayName: string) => {
    const enroll = await webauthnPrf.enroll(displayName);
    await window.nexus.hardwareKey.setup({
      credentialId: enroll.credentialId,
      prfSalt: enroll.prfSalt,
      prfOutput: enroll.prfOutput,
      rpId: enroll.rpId,
      userHandle: enroll.userHandle,
    });
  },

  // ── Load all data ──────────────────────────────────────────

  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      // Load vaults first to get IDs for scoped queries
      let vaultsList = await window.nexus.vaults.list() as Vault[];

      // Auto-create default vault container if none exist (migration for pre-fix DBs)
      if (vaultsList.length === 0) {
        await window.nexus.vaults.create({ name: 'Default', description: 'Default vault' });
        vaultsList = await window.nexus.vaults.list() as Vault[];
      }

      const vaultId = vaultsList.length > 0 ? vaultsList[0].id : null;

      let hostsList: Host[] = [];
      let groupsList: Group[] = [];
      let identitiesList: Identity[] = [];
      let snippetsList: Snippet[] = [];
      let keysList: SSHKey[] = [];
      let tagsList: Tag[] = [];

      if (vaultId) {
        [hostsList, groupsList, identitiesList, snippetsList, keysList, tagsList] =
          await Promise.all([
            window.nexus.hosts.list(vaultId) as Promise<Host[]>,
            window.nexus.groups.list(vaultId) as Promise<Group[]>,
            window.nexus.identities.list(vaultId) as Promise<Identity[]>,
            window.nexus.snippets.list(vaultId) as Promise<Snippet[]>,
            window.nexus.keychain.listKeys(vaultId) as Promise<SSHKey[]>,
            window.nexus.tags.list() as Promise<Tag[]>,
          ]);
      }

      set({
        vaults: vaultsList,
        selectedVaultId: vaultId,
        hosts: hostsList,
        groups: groupsList,
        identities: identitiesList,
        snippets: snippetsList,
        keys: keysList,
        tags: tagsList,
        loading: false,
      });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  // ── Hosts ──────────────────────────────────────────────────

  addHost: async (host) => {
    try {
      const created = await window.nexus.hosts.create(host) as Host;
      set((state) => ({ hosts: [...state.hosts, created] }));
      return created;
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  updateHost: async (id, updates) => {
    try {
      await window.nexus.hosts.update(id, updates);
      set((state) => ({
        hosts: state.hosts.map((h) => (h.id === id ? { ...h, ...updates } : h)),
      }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  deleteHost: async (id) => {
    try {
      await window.nexus.hosts.delete(id);
      set((state) => ({
        hosts: state.hosts.filter((h) => h.id !== id),
        selectedHostId: state.selectedHostId === id ? null : state.selectedHostId,
      }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  // ── Groups ─────────────────────────────────────────────────

  addGroup: async (group) => {
    try {
      const created = await window.nexus.groups.create(group) as Group;
      set((state) => ({ groups: [...state.groups, created] }));
      return created;
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  updateGroup: async (id, updates) => {
    try {
      await window.nexus.groups.update(id, updates);
      set((state) => ({
        groups: state.groups.map((g) => (g.id === id ? { ...g, ...updates } : g)),
      }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  deleteGroup: async (id) => {
    try {
      await window.nexus.groups.delete(id);
      set((state) => ({
        groups: state.groups.filter((g) => g.id !== id),
        selectedGroupId: state.selectedGroupId === id ? null : state.selectedGroupId,
      }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  // ── Identities ─────────────────────────────────────────────

  addIdentity: async (identity) => {
    try {
      const created = await window.nexus.identities.create(identity) as Identity;
      set((state) => ({ identities: [...state.identities, created] }));
      return created;
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  updateIdentity: async (id, updates) => {
    try {
      await window.nexus.identities.update(id, updates);
      set((state) => ({
        identities: state.identities.map((i) => (i.id === id ? { ...i, ...updates } : i)),
      }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  deleteIdentity: async (id) => {
    try {
      await window.nexus.identities.delete(id);
      set((state) => ({
        identities: state.identities.filter((i) => i.id !== id),
      }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  // ── Tags ───────────────────────────────────────────────────

  addTag: async (tag) => {
    try {
      const created = await window.nexus.tags.create(tag) as Tag;
      set((state) => ({ tags: [...state.tags, created] }));
      return created;
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  updateTag: async (id, updates) => {
    try {
      await window.nexus.tags.update(id, updates);
      set((state) => ({
        tags: state.tags.map((t) => (t.id === id ? { ...t, ...updates } : t)),
      }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  deleteTag: async (id) => {
    try {
      await window.nexus.tags.delete(id);
      set((state) => ({
        tags: state.tags.filter((t) => t.id !== id),
      }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    }
  },

  // ── Snippets ───────────────────────────────────────────────

  addSnippet: async (snippet) => {
    set({ loading: true, error: null });
    try {
      const created = await window.nexus.snippets.create(snippet) as Snippet;
      set((state) => ({
        snippets: [...state.snippets, created],
        loading: false,
      }));
      return created;
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
      throw err;
    }
  },

  updateSnippet: async (id, updates) => {
    set({ loading: true, error: null });
    try {
      await window.nexus.snippets.update(id, updates);
      set((state) => ({
        snippets: state.snippets.map((s) => (s.id === id ? { ...s, ...updates } as Snippet : s)),
        loading: false,
      }));
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
      throw err;
    }
  },

  deleteSnippet: async (id) => {
    set({ loading: true, error: null });
    try {
      await window.nexus.snippets.delete(id);
      set((state) => ({
        snippets: state.snippets.filter((s) => s.id !== id),
        loading: false,
      }));
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
      throw err;
    }
  },

  // ── Keys ───────────────────────────────────────────────────

  loadKeys: async () => {
    try {
      const vaultId = get().selectedVaultId;
      if (!vaultId) {
        set({ keys: [] });
        return;
      }
      const keys = (await window.nexus.keychain.listKeys(vaultId)) as SSHKey[];
      set({ keys });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  // ── Selection ──────────────────────────────────────────────

  setSelectedHostId: (id) => set({ selectedHostId: id }),
  setSelectedGroupId: (id) => set({ selectedGroupId: id }),
  setSelectedVaultId: (id) => set({ selectedVaultId: id }),

  // ── Reset ──────────────────────────────────────────────────

  reset: () => set(initialState),
}));
