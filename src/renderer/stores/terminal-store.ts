import { create } from 'zustand';
import type { SSHSession } from '../../shared/types';

// ============================================================
// Terminal Store — manages SSH sessions and terminal tabs
// ============================================================

export interface TerminalTab {
  id: string;
  type: 'terminal' | 'sftp';
  label: string;
  colour: string | null;
  sessionId: string | null;
}

export interface TerminalState {
  sessions: SSHSession[];
  tabs: TerminalTab[];
  activeSessionId: string | null;
  activeTabId: string | null;
}

export interface TerminalActions {
  // Sessions
  connectSession: (hostId: string) => Promise<string>;
  openSftpSession: (hostId: string) => Promise<string>;
  disconnectSession: (sessionId: string) => Promise<void>;
  updateSession: (sessionId: string, updates: Partial<SSHSession>) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  refreshSessions: () => Promise<void>;

  // Tabs
  addTab: (tab: Omit<TerminalTab, 'id'>) => string;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string | null) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  updateTab: (tabId: string, updates: Partial<TerminalTab>) => void;

  // Terminal I/O
  writeToSession: (sessionId: string, data: string) => void;
  resizeSession: (sessionId: string, cols: number, rows: number) => void;

  // Reset
  reset: () => void;
}

let tabIdCounter = 0;
function generateTabId(): string {
  tabIdCounter += 1;
  return `tab-${Date.now()}-${tabIdCounter}`;
}

const initialState: TerminalState = {
  sessions: [],
  tabs: [],
  activeSessionId: null,
  activeTabId: null,
};

export const useTerminalStore = create<TerminalState & TerminalActions>()((set, get) => ({
  ...initialState,

  // ── Sessions ───────────────────────────────────────────────

  connectSession: async (hostId: string) => {
    console.log(`[store] connectSession called for hostId=${hostId}`);
    // Look up host info from the vault store before connecting
    const vaultStore = (await import('./vault-store')).useVaultStore.getState();
    const host = vaultStore.hosts.find((h) => h.id === hostId);
    const label = host?.label ?? 'Unknown';
    const colour = host?.colour ?? null;
    const hostname = host?.hostname ?? '';

    // Check if there's already a connected tab for this host
    const existingTab = get().tabs.find(
      (t) => t.type === 'terminal' && get().sessions.find(
        (s) => s.id === t.sessionId && s.hostId === hostId && s.connected,
      ),
    );
    if (existingTab) {
      set({ activeTabId: existingTab.id, activeSessionId: existingTab.sessionId });
      return existingTab.sessionId!;
    }

    // Create a placeholder session ID and session/tab immediately so the UI
    // can show "connecting" status. We'll update the session with the real
    // ID after ssh.connect resolves.
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const pendingSession: SSHSession = {
      id: tempId,
      hostId,
      label,
      colour,
      connected: false,
      status: 'connecting',
      hostname,
      error: null,
      startedAt: new Date().toISOString(),
    };

    set((state) => ({
      sessions: [...state.sessions, pendingSession],
      activeSessionId: tempId,
    }));

    const tabId = get().addTab({
      type: 'terminal',
      label,
      colour,
      sessionId: tempId,
    });
    set({ activeTabId: tabId });

    // Kick off the real connection in the background
    (async () => {
      try {
        const realSessionId = (await window.nexus.ssh.connect(hostId)) as string;

        // Swap the temp ID for the real one on both the session and the tab
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === tempId
              ? { ...s, id: realSessionId, connected: true, status: 'connected' }
              : s,
          ),
          tabs: state.tabs.map((t) =>
            t.sessionId === tempId ? { ...t, sessionId: realSessionId } : t,
          ),
          activeSessionId:
            state.activeSessionId === tempId ? realSessionId : state.activeSessionId,
        }));
      } catch (err) {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === tempId
              ? { ...s, status: 'error', error: (err as Error).message }
              : s,
          ),
        }));
      }
    })();

    return tempId;
  },

  openSftpSession: async (hostId: string) => {
    console.log(`[store] openSftpSession called for hostId=${hostId}`);
    // Look up host info from the vault store
    const vaultStore = (await import('./vault-store')).useVaultStore.getState();
    const host = vaultStore.hosts.find((h) => h.id === hostId);
    const label = host?.label ?? 'Unknown';
    const colour = host?.colour ?? null;
    const hostname = host?.hostname ?? '';

    // Check if there's already an SFTP tab for this host
    const existingTab = get().tabs.find(
      (t) => t.type === 'sftp' && get().sessions.find(
        (s) => s.id === t.sessionId && s.hostId === hostId && s.connected,
      ),
    );
    if (existingTab) {
      set({ activeTabId: existingTab.id, activeSessionId: existingTab.sessionId });
      return existingTab.sessionId!;
    }

    // Create a placeholder session/tab so the UI shows a connecting state
    const tempId = `pending-sftp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const pendingSession: SSHSession = {
      id: tempId,
      hostId,
      label,
      colour,
      connected: false,
      status: 'connecting',
      hostname,
      error: null,
      startedAt: new Date().toISOString(),
    };

    set((state) => ({
      sessions: [...state.sessions, pendingSession],
      activeSessionId: tempId,
    }));

    const tabId = get().addTab({
      type: 'sftp',
      label: `${label} (SFTP)`,
      colour,
      sessionId: tempId,
    });
    set({ activeTabId: tabId });

    // Establish the SSH connection in the background
    (async () => {
      try {
        const realSessionId = (await window.nexus.ssh.connect(hostId)) as string;

        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === tempId
              ? { ...s, id: realSessionId, connected: true, status: 'connected' }
              : s,
          ),
          tabs: state.tabs.map((t) =>
            t.sessionId === tempId ? { ...t, sessionId: realSessionId } : t,
          ),
          activeSessionId:
            state.activeSessionId === tempId ? realSessionId : state.activeSessionId,
        }));
      } catch (err) {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === tempId
              ? { ...s, status: 'error', error: (err as Error).message }
              : s,
          ),
        }));
      }
    })();

    return tempId;
  },

  disconnectSession: async (sessionId: string) => {
    await window.nexus.ssh.disconnect(sessionId);
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, connected: false } : s
      ),
    }));
  },

  updateSession: (sessionId, updates) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, ...updates } : s
      ),
    }));
  },

  removeSession: (sessionId) => {
    set((state) => {
      const newSessions = state.sessions.filter((s) => s.id !== sessionId);
      const newTabs = state.tabs.filter((t) => t.sessionId !== sessionId);
      const removedTab = state.tabs.find((t) => t.sessionId === sessionId);
      let newActiveTabId = state.activeTabId;
      let newActiveSessionId = state.activeSessionId;

      if (removedTab && state.activeTabId === removedTab.id) {
        newActiveTabId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
        const activeTab = newTabs.find((t) => t.id === newActiveTabId);
        newActiveSessionId = activeTab?.sessionId ?? null;
      }

      if (state.activeSessionId === sessionId) {
        newActiveSessionId = newSessions.length > 0
          ? newSessions[newSessions.length - 1].id
          : null;
      }

      return {
        sessions: newSessions,
        tabs: newTabs,
        activeSessionId: newActiveSessionId,
        activeTabId: newActiveTabId,
      };
    });
  },

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  refreshSessions: async () => {
    const sessions = await window.nexus.ssh.listSessions() as SSHSession[];
    set({ sessions });
  },

  // ── Tabs ───────────────────────────────────────────────────

  addTab: (tab) => {
    const id = generateTabId();
    const newTab: TerminalTab = { ...tab, id };
    console.log(`[store] addTab type=${tab.type} label=${tab.label} id=${id}`);
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: id,
    }));
    return id;
  },

  removeTab: (tabId) => {
    // Capture the tab's session id BEFORE mutating state so we can
    // disconnect the backend SSH connection.
    const tab = get().tabs.find((t) => t.id === tabId);
    const sessionIdToClose = tab?.sessionId ?? null;

    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === tabId);
      const newTabs = state.tabs.filter((t) => t.id !== tabId);
      let newActiveTabId = state.activeTabId;

      if (state.activeTabId === tabId) {
        if (newTabs.length > 0) {
          const newIdx = Math.max(0, idx - 1);
          newActiveTabId = newTabs[newIdx].id;
        } else {
          newActiveTabId = null;
        }
      }

      const activeTab = newTabs.find((t) => t.id === newActiveTabId);
      const newActiveSessionId = activeTab?.sessionId ?? null;

      // Remove the session from the sessions array if no other tab uses it
      const stillUsed = newTabs.some((t) => t.sessionId === sessionIdToClose);
      const newSessions = stillUsed
        ? state.sessions
        : state.sessions.filter((s) => s.id !== sessionIdToClose);

      return {
        tabs: newTabs,
        sessions: newSessions,
        activeTabId: newActiveTabId,
        activeSessionId: newActiveSessionId,
      };
    });

    // Fire-and-forget disconnect on the backend so the ssh2 client is closed
    if (sessionIdToClose && !sessionIdToClose.startsWith('pending-')) {
      window.nexus.ssh.disconnect(sessionIdToClose).catch(() => {
        // Ignore — may already be closed
      });
    }
  },

  setActiveTab: (tabId) => {
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      return {
        activeTabId: tabId,
        activeSessionId: tab?.sessionId ?? state.activeSessionId,
      };
    });
  },

  reorderTabs: (fromIndex, toIndex) => {
    set((state) => {
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      if (moved) {
        tabs.splice(toIndex, 0, moved);
      }
      return { tabs };
    });
  },

  updateTab: (tabId, updates) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
    }));
  },

  // ── Terminal I/O ───────────────────────────────────────────

  writeToSession: (sessionId, data) => {
    window.nexus.ssh.write(sessionId, data);
  },

  resizeSession: (sessionId, cols, rows) => {
    window.nexus.ssh.resize(sessionId, cols, rows);
  },

  // ── Reset ──────────────────────────────────────────────────

  reset: () => set(initialState),
}));
