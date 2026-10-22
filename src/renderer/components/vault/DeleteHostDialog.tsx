import React, { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Dialog } from '../ui';
import { useVaultStore, useTerminalStore, useUIStore } from '../../stores';
import { tabsForHost, openTabsLabel } from '../../lib/host-tabs';
import type { Host } from '../../../shared/types';

// ============================================================
// DeleteHostDialog — confirm, then remove a host from the vault (#3098)
//
// Opened from the host's "More actions" menu and from the Edit host dialog. Any terminal or
// SFTP tab open on the host is closed first (which disconnects it), then the host row goes.
// ============================================================

export interface DeleteHostDialogProps {
  /** The host to delete; null keeps the dialog closed. */
  host: Host | null;
  onClose: () => void;
}

export function DeleteHostDialog({ host, onClose }: DeleteHostDialogProps): React.ReactElement {
  const deleteHost = useVaultStore((s) => s.deleteHost);
  const tabs = useTerminalStore((s) => s.tabs);
  const sessions = useTerminalStore((s) => s.sessions);
  const removeTab = useTerminalStore((s) => s.removeTab);
  const addNotification = useUIStore((s) => s.addNotification);
  const [deleting, setDeleting] = useState(false);

  const openTabs = useMemo(() => (host ? tabsForHost(tabs, sessions, host.id) : []), [tabs, sessions, host]);

  const handleDelete = async () => {
    if (!host) return;
    setDeleting(true);
    try {
      openTabs.forEach((tab) => removeTab(tab.id));
      await deleteHost(host.id);
      addNotification('success', `Host "${host.label}" deleted`);
      onClose();
    } catch (err) {
      addNotification('error', `Failed to delete host: ${(err as Error).message}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog
      open={host !== null}
      onClose={() => {
        if (!deleting) onClose();
      }}
      size="sm"
      title={host ? `Delete ${host.label}?` : 'Delete host?'}
      description="This removes the host and its saved login details from the vault. The server itself isn’t touched."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" icon={Trash2} loading={deleting} onClick={() => void handleDelete()}>
            Delete Host
          </Button>
        </>
      }
    >
      {openTabs.length > 0 ? (
        <p className="text-body text-fg-secondary">
          This host has {openTabsLabel(openTabs.length)}, which will be closed and disconnected.
        </p>
      ) : undefined}
    </Dialog>
  );
}

export default DeleteHostDialog;
