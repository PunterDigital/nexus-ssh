import React, { useCallback, useEffect, useState } from 'react';
import { useUIStore, useVaultStore, useTerminalStore, useSFTPStore } from '../../stores';
import { Button, Dialog } from '../ui';

// ============================================================
// SwitchVaultHost — carries out "Switch vault" (#2363)
// ============================================================
//
// Anything can call useUIStore.requestVaultSwitch(). With no open tabs the vault is locked
// straight away; otherwise the user confirms first, because the switch closes every SSH and
// SFTP session (they belong to the vault being left). Then the lock screen opens on the
// vault picker, where another vault can be unlocked or created without restarting the app.

export function SwitchVaultHost(): React.ReactElement | null {
  const requested = useUIStore((s) => s.vaultSwitchRequested);
  const cancelVaultSwitch = useUIStore((s) => s.cancelVaultSwitch);
  const tabCount = useTerminalStore((s) => s.tabs.length);
  const [switching, setSwitching] = useState(false);

  const performSwitch = useCallback(async () => {
    setSwitching(true);
    try {
      await useVaultStore.getState().switchVault();
      useTerminalStore.getState().reset();
      useSFTPStore.getState().reset();
      const ui = useUIStore.getState();
      ui.setView('connections');
      ui.showVaultPicker();
    } catch (err) {
      useUIStore.getState().cancelVaultSwitch();
      useUIStore
        .getState()
        .addNotification('error', `Could not switch vault: ${(err as Error).message}`);
    } finally {
      setSwitching(false);
    }
  }, []);

  // Nothing open: no need to ask.
  useEffect(() => {
    if (requested && tabCount === 0 && !switching) {
      void performSwitch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  if (!requested || tabCount === 0) return null;

  return (
    <Dialog
      open
      onClose={() => {
        if (!switching) cancelVaultSwitch();
      }}
      title="Switch vault?"
      size="sm"
      description={
        <>
          {tabCount === 1 ? 'Your open session' : `Your ${tabCount} open sessions`} will be closed and this
          vault will be locked. You can then open another vault.
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={cancelVaultSwitch} disabled={switching}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void performSwitch()} loading={switching}>
            Close Sessions and Switch
          </Button>
        </>
      }
    />
  );
}

export default SwitchVaultHost;
