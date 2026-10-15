import { create } from 'zustand';
import type { UpdateStatus } from '../../shared/types';

// ============================================================
// Update Store — the main process's update status (src/main/updater)
// ============================================================

export interface UpdateState {
  status: UpdateStatus | null;
  /** "Later" hides the banner for that version until the next manual check. */
  dismissedVersion: string | null;
}

export interface UpdateActions {
  setStatus: (status: UpdateStatus) => void;
  dismiss: (version: string) => void;
  /** Manual "Check for Updates": un-hides the banner and returns the result. */
  checkNow: () => Promise<UpdateStatus>;
}

export const useUpdateStore = create<UpdateState & UpdateActions>((set) => ({
  status: null,
  dismissedVersion: null,
  setStatus: (status) => set({ status }),
  dismiss: (version) => set({ dismissedVersion: version }),
  checkNow: async () => {
    set({ dismissedVersion: null });
    const status = await window.nexus.updater.check();
    set({ status });
    return status;
  },
}));
