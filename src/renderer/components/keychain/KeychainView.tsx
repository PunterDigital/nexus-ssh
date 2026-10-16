import React, { useMemo, useState } from 'react';
import { Copy, Ellipsis, Eye, Import, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useVaultStore } from '../../stores/vault-store';
import { useUIStore } from '../../stores/ui-store';
import { Icon } from '../common/Icon';
import { Button, Dialog, EmptyState, IconButton, Menu, cx, type MenuEntry } from '../ui';
import { GenerateKeyDialog } from './GenerateKeyDialog';
import { ImportKeyDialog } from './ImportKeyDialog';
import { KeyDetailsDialog } from './KeyDetailsDialog';
import { keyTypeBadge } from './keyType';
import type { SSHKey } from '../../../shared/types';

// ============================================================
// KeychainView — the vault's SSH keys (design system: #2367). Header with the count and the
// Generate / Import actions, then one row per key: the row opens the key's details, the copy
// button copies its public key, and "More actions" holds details, copy and delete. Deleting
// asks first in a Dialog named after the key. Fits a 560 px main area: the header wraps and
// long names / fingerprints truncate with a tooltip.
// ============================================================

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export const KeychainView: React.FC = () => {
  const keys = useVaultStore((s) => s.keys);
  const identities = useVaultStore((s) => s.identities);
  const hosts = useVaultStore((s) => s.hosts);
  const addNotification = useUIStore((s) => s.addNotification);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteKey, setDeleteKey] = useState<SSHKey | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [viewKeyId, setViewKeyId] = useState<string | null>(null);

  // key_id -> what uses it: identities with the key, hosts through such an identity, and hosts
  // that use the key directly (the host form's "SSH key" method).
  const keyReferences = useMemo(() => {
    const refs: Record<string, string[]> = {};
    const add = (keyId: string, label: string) => {
      (refs[keyId] ??= []).push(label);
    };
    for (const identity of identities) {
      if (identity.key_id) add(identity.key_id, `Identity: ${identity.name}`);
    }
    for (const host of hosts) {
      if (host.key_id) {
        add(host.key_id, `Host: ${host.label}`);
      } else if (host.identity_id) {
        const identity = identities.find((i) => i.id === host.identity_id);
        if (identity?.key_id) add(identity.key_id, `Host: ${host.label}`);
      }
    }
    return refs;
  }, [identities, hosts]);

  const handleCopyPublicKey = async (key: SSHKey) => {
    try {
      await navigator.clipboard.writeText(key.public_key);
      addNotification('success', `Public key "${key.name}" copied to clipboard`);
    } catch {
      addNotification('error', 'Failed to copy public key to clipboard');
    }
  };

  const handleDeleteKey = async (id: string) => {
    setDeleting(true);
    try {
      await window.nexus.keychain.deleteKey(id);
      await useVaultStore.getState().loadKeys();
      addNotification('success', 'SSH key deleted');
      setDeleteKey(null);
    } catch (err) {
      addNotification('error', `Failed to delete key: ${(err as Error).message}`);
    } finally {
      setDeleting(false);
    }
  };

  const keyActions = (key: SSHKey): MenuEntry[] => [
    { id: 'details', label: 'View details', icon: Eye, onSelect: () => setViewKeyId(key.id) },
    { id: 'copy', label: 'Copy public key', icon: Copy, onSelect: () => void handleCopyPublicKey(key) },
    { separator: true, id: 'sep' },
    { id: 'delete', label: 'Delete key…', icon: Trash2, danger: true, onSelect: () => setDeleteKey(key) },
  ];

  const deleteRefs = deleteKey ? (keyReferences[deleteKey.id] ?? []) : [];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      {/* Header: wraps onto a second row in narrow windows instead of squashing */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <div className="mr-auto flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-heading-sm font-semibold text-fg">SSH Keychain</h2>
          <span className="shrink-0 text-body-sm text-fg-muted">
            {keys.length} key{keys.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="primary" icon={Plus} onClick={() => setGenerateOpen(true)}>
            Generate Key
          </Button>
          <Button icon={Import} onClick={() => setImportOpen(true)}>
            Import Key
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
        {keys.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No SSH keys yet"
            description={
              <>
                <span className="font-medium text-fg-secondary">Generate</span> a new key or{' '}
                <span className="font-medium text-fg-secondary">import</span> one you already use to get
                started.
              </>
            }
            className="h-full"
          />
        ) : (
          <ul aria-label="SSH keys" className="flex flex-col gap-2">
            {keys.map((key) => (
              <KeyRow
                key={key.id}
                sshKey={key}
                refs={keyReferences[key.id] ?? []}
                actions={keyActions(key)}
                onOpen={() => setViewKeyId(key.id)}
                onCopy={() => void handleCopyPublicKey(key)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Dialogs */}
      <GenerateKeyDialog open={generateOpen} onClose={() => setGenerateOpen(false)} />
      <ImportKeyDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <KeyDetailsDialog keyId={viewKeyId} onClose={() => setViewKeyId(null)} />

      <Dialog
        open={deleteKey !== null}
        onClose={() => {
          if (!deleting) setDeleteKey(null);
        }}
        size="sm"
        title={deleteKey ? `Delete ${deleteKey.name}?` : 'Delete key?'}
        description="This permanently removes the key from the vault. Servers that trust its public key aren’t changed."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteKey(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              loading={deleting}
              onClick={() => deleteKey && void handleDeleteKey(deleteKey.id)}
            >
              Delete Key
            </Button>
          </>
        }
      >
        {deleteRefs.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-body text-fg-secondary">
              In use by {deleteRefs.length === 1 ? 'one item' : `${deleteRefs.length} items`}, which can no
              longer sign in with it:
            </p>
            <ul className="flex flex-col gap-1 text-body-sm text-fg-muted">
              {deleteRefs.map((ref) => (
                <li key={ref} className="truncate" title={ref}>
                  {ref}
                </li>
              ))}
            </ul>
          </div>
        ) : undefined}
      </Dialog>
    </div>
  );
};

// ── Key row ─────────────────────────────────────────────────

interface KeyRowProps {
  sshKey: SSHKey;
  refs: string[];
  actions: MenuEntry[];
  onOpen: () => void;
  onCopy: () => void;
}

function KeyRow({ sshKey: key, refs, actions, onOpen, onCopy }: KeyRowProps): React.ReactElement {
  const badge = keyTypeBadge(key);
  return (
    <li
      className={cx(
        'group relative min-w-0 rounded-lg border border-line bg-surface-raised shadow-raised',
        'transition-colors duration-(--duration-fast) ease-standard hover:border-line-strong focus-within:border-line-strong',
      )}
    >
      {/* The row itself opens the details; the actions sit on top of its right edge. */}
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full min-w-0 items-start gap-3 rounded-lg p-3 pr-20 text-left transition-colors duration-(--duration-fast) hover:bg-surface-hover focus-ring"
      >
        <span className={cx('flex size-9 shrink-0 items-center justify-center rounded-md', badge.className)}>
          <Icon icon={KeyRound} size={16} />
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-body font-semibold text-fg" title={key.name}>
              {key.name}
            </span>
            <span className={cx('shrink-0 rounded-sm px-1.5 text-caption font-medium', badge.className)}>
              {badge.label}
            </span>
          </span>
          <span className="truncate font-code text-body-sm text-fg-muted" title={key.fingerprint}>
            {key.fingerprint}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 text-caption text-fg-muted">
            {refs.length > 0 && (
              <span className="min-w-0 truncate" title={refs.join(', ')}>
                Used by: {refs.length === 1 ? refs[0] : `${refs.length} items`}
              </span>
            )}
            <span className="shrink-0">Created {formatDate(key.created_at)}</span>
          </span>
        </span>
      </button>

      <div className="absolute top-3 right-3 flex items-center gap-1">
        <IconButton icon={Copy} size="sm" label={`Copy public key of ${key.name}`} onClick={onCopy} />
        <Menu
          align="end"
          label={`Actions for ${key.name}`}
          items={actions}
          trigger={(p) => <IconButton {...p} icon={Ellipsis} size="sm" label={`More actions for ${key.name}`} />}
        />
      </div>
    </li>
  );
}
