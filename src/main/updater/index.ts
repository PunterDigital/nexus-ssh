// ============================================================
// Nexus SSH Client — App updates (Electron wiring)
// Windows: electron-updater downloads from GitHub Releases (latest.yml) and waits for
// "Restart to update". macOS: GitHub API version check + a link to the downloads page.
// Dev and E2E builds never check (see resolveUpdateMode).
// ============================================================

import { app, type BrowserWindow } from 'electron';
import type { AppUpdater } from 'electron-updater';
import {
  IPC,
  LATEST_RELEASE_API_URL,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_SETTING,
  UPDATE_FIRST_CHECK_DELAY_MS,
} from '../../shared/constants';
import { readAppSettings } from '../ipc/app-settings-handlers';
import {
  Updater,
  fetchLatestReleaseVersion,
  resolveUpdateMode,
  scheduleUpdateChecks,
  type InstallUpdater,
} from './core';

let mainWindow: BrowserWindow | null = null;

const testFeedUrl = process.env.NEXUS_UPDATE_TEST_URL || undefined;

// eslint-disable-next-line no-console -- updater progress belongs in the main-process log
const log = (message: string) => console.log(message);

export const updater = new Updater({
  mode: resolveUpdateMode({
    platform: process.platform,
    isPackaged: app.isPackaged,
    isolatedProfile: !!process.env.NEXUS_USER_DATA_DIR,
    allowInTestProfile: process.env.NEXUS_UPDATE_IN_TEST_PROFILE === '1',
    disabledByEnv: process.env.NEXUS_DISABLE_UPDATES === '1',
    testFeedUrl,
  }),
  currentVersion: app.getVersion(),
  loadInstaller: async () => {
    // require, not import(): esbuild's ESM interop on the external CJS package loses the
    // autoUpdater getter (undefined in the packaged app). Lazy, so dev/E2E never load it.
    const { autoUpdater } = require('electron-updater') as { autoUpdater: AppUpdater };
    // Releases ship the full NSIS installer, never a web installer.
    autoUpdater.disableWebInstaller = true;
    autoUpdater.logger = {
      info: (m?: unknown) => log(`[updater] ${String(m)}`),
      warn: (m?: unknown) => log(`[updater] ${String(m)}`),
      error: (m?: unknown) => log(`[updater] ${String(m)}`),
      debug: () => {},
    };
    return autoUpdater as unknown as InstallUpdater;
  },
  fetchLatestVersion: () =>
    fetchLatestReleaseVersion(
      testFeedUrl ?? LATEST_RELEASE_API_URL,
      `Nexus/${app.getVersion()}`,
    ),
  send: (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.UPDATER_STATUS, status);
    }
  },
  log,
});

export function setUpdaterWindow(win: BrowserWindow): void {
  mainWindow = win;
}

/** Start background checks (no-op in dev / E2E). Default on; Settings can turn them off. */
export function startUpdateChecks(): void {
  log(`[updater] mode: ${updater.mode}`);
  scheduleUpdateChecks({
    updater,
    isEnabled: async () => (await readAppSettings())[UPDATE_CHECK_SETTING] !== false,
    firstDelayMs: UPDATE_FIRST_CHECK_DELAY_MS,
    intervalMs: UPDATE_CHECK_INTERVAL_MS,
  });
}
