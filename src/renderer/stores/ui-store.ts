import { create } from 'zustand';
import type { NexusTheme } from '../../shared/types';
import { draculaTheme, applyTheme, getThemeById } from '../styles/themes';

// ============================================================
// UI Store — manages application UI state
// ============================================================

export type ViewType = 'connections' | 'terminal' | 'sftp' | 'keychain' | 'snippets' | 'settings';

export interface ModalState {
  type: string;
  data?: unknown;
}

export interface UIState {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  currentView: ViewType;
  lockScreenVisible: boolean;
  theme: NexusTheme;
  modal: ModalState | null;
  commandPaletteOpen: boolean;
  notifications: NotificationItem[];
}

export interface NotificationItem {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: number;
}

export interface UIActions {
  // Sidebar
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Views
  setView: (view: ViewType) => void;

  // Lock screen
  setLockScreenVisible: (visible: boolean) => void;

  // Modal
  showModal: (type: string, data?: unknown) => void;
  hideModal: () => void;

  // Theme
  setTheme: (theme: NexusTheme) => void;
  setThemeById: (id: string) => void;
  loadPersistedTheme: () => Promise<void>;

  // Command palette
  toggleCommandPalette: () => void;
  setCommandPaletteOpen: (open: boolean) => void;

  // Notifications
  addNotification: (type: NotificationItem['type'], message: string) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;

  // Reset
  reset: () => void;
}

let notifIdCounter = 0;

const initialState: UIState = {
  sidebarWidth: 260,
  sidebarCollapsed: false,
  currentView: 'connections',
  lockScreenVisible: true,
  theme: draculaTheme,
  modal: null,
  commandPaletteOpen: false,
  notifications: [],
};

export const useUIStore = create<UIState & UIActions>()((set, get) => ({
  ...initialState,

  // ── Sidebar ────────────────────────────────────────────────

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  // ── Views ──────────────────────────────────────────────────

  setView: (view) => set({ currentView: view }),

  // ── Lock screen ────────────────────────────────────────────

  setLockScreenVisible: (visible) => set({ lockScreenVisible: visible }),

  // ── Modal ──────────────────────────────────────────────────

  showModal: (type, data) => set({ modal: { type, data } }),

  hideModal: () => set({ modal: null }),

  // ── Theme ──────────────────────────────────────────────────

  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
    // Persist to app-level settings (outside the vault) so it's shared
    // across vaults and available before unlock.
    window.nexus.appSettings.set('theme', theme.id).catch(() => {});
  },

  setThemeById: (id) => {
    const theme = getThemeById(id);
    applyTheme(theme);
    set({ theme });
    window.nexus.appSettings.set('theme', id).catch(() => {});
  },

  loadPersistedTheme: async () => {
    try {
      const id = (await window.nexus.appSettings.get('theme')) as string | null;
      if (id) {
        const theme = getThemeById(id);
        applyTheme(theme);
        set({ theme });
      }
    } catch {
      // Ignore — fall back to default theme
    }
  },

  // ── Command palette ────────────────────────────────────────

  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  // ── Notifications ──────────────────────────────────────────

  addNotification: (type, message) => {
    notifIdCounter += 1;
    const notification: NotificationItem = {
      id: `notif-${Date.now()}-${notifIdCounter}`,
      type,
      message,
      timestamp: Date.now(),
    };
    set((state) => ({
      notifications: [...state.notifications, notification],
    }));

    // Auto-remove after 5 seconds
    setTimeout(() => {
      get().removeNotification(notification.id);
    }, 5000);
  },

  removeNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),

  clearNotifications: () => set({ notifications: [] }),

  // ── Reset ──────────────────────────────────────────────────

  reset: () => set(initialState),
}));
