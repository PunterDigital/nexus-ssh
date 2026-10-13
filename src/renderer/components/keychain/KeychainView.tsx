import React, { useState, useMemo } from 'react';
import { useVaultStore } from '../../stores/vault-store';
import { useUIStore } from '../../stores/ui-store';
import { GenerateKeyDialog } from './GenerateKeyDialog';
import { ImportKeyDialog } from './ImportKeyDialog';
import { KeyDetailsDialog } from './KeyDetailsDialog';
import type { SSHKey, KeyType } from '../../../shared/types';

// ============================================================
// KeychainView — Main keychain panel showing all SSH keys
// ============================================================

const KEY_TYPE_LABELS: Record<KeyType, string> = {
  ed25519: 'Ed25519',
  rsa: 'RSA',
  ecdsa: 'ECDSA',
};

function getKeyTypeBadge(key: SSHKey): { label: string; bgColor: string; textColor: string } {
  const bits = key.bits ? ` ${key.bits}` : '';
  switch (key.key_type) {
    case 'ed25519':
      return { label: 'Ed25519', bgColor: 'rgba(158, 206, 106, 0.15)', textColor: 'var(--color-success)' };
    case 'rsa':
      return { label: `RSA${bits}`, bgColor: 'rgba(122, 162, 247, 0.15)', textColor: 'var(--color-accent)' };
    case 'ecdsa':
      return { label: `ECDSA${bits}`, bgColor: 'rgba(224, 175, 104, 0.15)', textColor: 'var(--color-warning)' };
    default:
      return { label: key.key_type, bgColor: 'var(--color-bg-tertiary)', textColor: 'var(--color-text-muted)' };
  }
}

function truncateFingerprint(fp: string, maxLen = 32): string {
  if (fp.length <= maxLen) return fp;
  return fp.slice(0, maxLen) + '...';
}

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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [viewKeyId, setViewKeyId] = useState<string | null>(null);

  // Build a map of key_id -> referencing entities
  const keyReferences = useMemo(() => {
    const refs: Record<string, string[]> = {};
    for (const identity of identities) {
      if (identity.key_id) {
        if (!refs[identity.key_id]) refs[identity.key_id] = [];
        refs[identity.key_id].push(`Identity: ${identity.name}`);
      }
    }
    for (const host of hosts) {
      if (host.identity_id) {
        const identity = identities.find((i) => i.id === host.identity_id);
        if (identity?.key_id) {
          if (!refs[identity.key_id]) refs[identity.key_id] = [];
          refs[identity.key_id].push(`Host: ${host.label}`);
        }
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
      setDeleteConfirmId(null);
    } catch (err) {
      addNotification('error', `Failed to delete key: ${(err as Error).message}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col h-full w-full" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
      {/* Header */}
      <div
        className="flex w-full items-center justify-between px-5 py-3 border-b no-select"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          SSH Keychain
        </h1>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-primary"
            onClick={() => setGenerateOpen(true)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="7" y1="2" x2="7" y2="12" />
              <line x1="2" y1="7" x2="12" y2="7" />
            </svg>
            Generate Key
          </button>
          <button
            className="btn btn-ghost"
            style={{ border: '1px solid var(--color-border)' }}
            onClick={() => setImportOpen(true)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 10v2h10v-2" />
              <path d="M7 2v7" />
              <path d="M4 6l3 3 3-3" />
            </svg>
            Import Key
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-5">
        {keys.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5">
              <rect x="8" y="20" width="32" height="20" rx="3" />
              <circle cx="24" cy="14" r="8" />
              <circle cx="24" cy="30" r="2" />
              <line x1="24" y1="32" x2="24" y2="36" />
            </svg>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              No SSH keys yet. Generate or import a key to get started.
            </p>
          </div>
        ) : (
          /* Key list */
          <div className="flex flex-col gap-2">
            {keys.map((key) => {
              const badge = getKeyTypeBadge(key);
              const refs = keyReferences[key.id] || [];
              const isDeleteConfirm = deleteConfirmId === key.id;

              return (
                <div
                  key={key.id}
                  onClick={() => setViewKeyId(key.id)}
                  className="flex items-start gap-4 p-4 rounded-lg border transition-colors cursor-pointer hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-tertiary)]"
                  style={{
                    backgroundColor: 'var(--color-bg-secondary)',
                    borderColor: 'var(--color-border)',
                  }}
                >
                  {/* Key icon */}
                  <div
                    className="flex items-center justify-center w-9 h-9 rounded-md mt-0.5 shrink-0"
                    style={{ backgroundColor: badge.bgColor }}
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke={badge.textColor} strokeWidth="1.5">
                      <circle cx="6" cy="7" r="3" />
                      <path d="M9 7h6" />
                      <path d="M13 7v3" />
                      <path d="M15 7v2" />
                    </svg>
                  </div>

                  {/* Key info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="text-sm font-medium truncate"
                        style={{ color: 'var(--color-text-primary)' }}
                      >
                        {key.name}
                      </span>
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide shrink-0"
                        style={{ backgroundColor: badge.bgColor, color: badge.textColor }}
                      >
                        {badge.label}
                      </span>
                    </div>

                    {/* Fingerprint */}
                    <div
                      className="text-xs font-mono mb-1 truncate"
                      style={{ color: 'var(--color-text-muted)' }}
                      title={key.fingerprint}
                    >
                      {truncateFingerprint(key.fingerprint, 48)}
                    </div>

                    {/* References and date */}
                    <div className="flex items-center gap-3 flex-wrap">
                      {refs.length > 0 && (
                        <span
                          className="text-[11px]"
                          style={{ color: 'var(--color-text-muted)' }}
                          title={refs.join(', ')}
                        >
                          Used by: {refs.length === 1 ? refs[0] : `${refs.length} items`}
                        </span>
                      )}
                      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                        Created {formatDate(key.created_at)}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="btn btn-ghost"
                      onClick={() => handleCopyPublicKey(key)}
                      title="Copy public key"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="4" y="4" width="8" height="8" rx="1.5" />
                        <path d="M10 4V2.5A1.5 1.5 0 008.5 1H2.5A1.5 1.5 0 001 2.5v6A1.5 1.5 0 002.5 10H4" />
                      </svg>
                      Copy Public Key
                    </button>

                    {isDeleteConfirm ? (
                      <div className="flex items-center gap-1">
                        <button
                          className="btn btn-danger"
                          onClick={() => handleDeleteKey(key.id)}
                          disabled={deleting}
                        >
                          {deleting ? 'Deleting...' : 'Confirm'}
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={() => setDeleteConfirmId(null)}
                          disabled={deleting}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn btn-ghost"
                        onClick={() => setDeleteConfirmId(key.id)}
                        title="Delete key"
                        style={{ color: 'var(--color-danger)' }}
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M2 4h10" />
                          <path d="M5 4V2.5A.5.5 0 015.5 2h3a.5.5 0 01.5.5V4" />
                          <path d="M3 4v8.5a.5.5 0 00.5.5h7a.5.5 0 00.5-.5V4" />
                          <line x1="6" y1="7" x2="6" y2="10" />
                          <line x1="8" y1="7" x2="8" y2="10" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <GenerateKeyDialog open={generateOpen} onClose={() => setGenerateOpen(false)} />
      <ImportKeyDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <KeyDetailsDialog keyId={viewKeyId} onClose={() => setViewKeyId(null)} />
    </div>
  );
};
