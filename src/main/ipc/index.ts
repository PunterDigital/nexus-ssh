// ============================================================
// Nexus SSH Client — IPC Handler Registration
// ============================================================

import { registerVaultHandlers } from './vault-handlers';
import { registerHardwareKeyHandlers } from './hardware-key-handlers';
import { registerCrudHandlers } from './crud-handlers';
import { registerSSHHandlers } from './ssh-handlers';
import { registerSFTPHandlers } from './sftp-handlers';
import { registerKeychainHandlers } from './keychain-handlers';
import { registerSyncHandlers } from './sync-handlers';
import { registerSettingsHandlers } from './settings-handlers';
import { registerClipboardHandlers } from './clipboard-handlers';
import { registerFsHandlers } from './fs-handlers';
import { registerAppSettingsHandlers } from './app-settings-handlers';

/**
 * Register all IPC handlers for the main process.
 * Call this once during app startup, before any renderer windows are created.
 */
export function registerAllHandlers(): void {
  registerVaultHandlers();
  registerHardwareKeyHandlers();
  registerCrudHandlers();
  registerSSHHandlers();
  registerSFTPHandlers();
  registerKeychainHandlers();
  registerSyncHandlers();
  registerSettingsHandlers();
  registerClipboardHandlers();
  registerFsHandlers();
  registerAppSettingsHandlers();
}
