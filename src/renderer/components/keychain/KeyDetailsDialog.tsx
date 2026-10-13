import React, { useEffect, useState, useCallback } from 'react';
import { Modal } from '../common/Modal';
import { useUIStore } from '../../stores/ui-store';
import type { SSHKey } from '../../../shared/types';

// ============================================================
// KeyDetailsDialog — view a single SSH key's public + private
// material with copy-to-clipboard and show/hide toggles.
// ============================================================

interface KeyDetailsDialogProps {
  keyId: string | null;
  onClose: () => void;
}

export const KeyDetailsDialog: React.FC<KeyDetailsDialogProps> = ({ keyId, onClose }) => {
  const addNotification = useUIStore((s) => s.addNotification);
  const [key, setKey] = useState<SSHKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrivate, setShowPrivate] = useState(false);

  // Load full key whenever the dialog opens with a new keyId
  useEffect(() => {
    if (!keyId) {
      setKey(null);
      setError(null);
      setShowPrivate(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setShowPrivate(false);
    window.nexus.keychain
      .getFullKey(keyId)
      .then((k) => {
        if (!cancelled) setKey(k as SSHKey);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [keyId]);

  const handleCopy = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text);
        addNotification('success', `${label} copied to clipboard`);
      } catch {
        addNotification('error', `Failed to copy ${label.toLowerCase()}`);
      }
    },
    [addNotification],
  );

  const maskedPrivateKey = key?.private_key
    ? key.private_key.replace(/[^\n]/g, '\u2022')
    : '';

  return (
    <Modal
      open={keyId !== null}
      onClose={onClose}
      title={key ? key.name : 'Key Details'}
      maxWidth="max-w-2xl"
    >
      <div className="flex flex-col gap-4" style={{ maxHeight: '70vh' }}>
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-bg-tertiary)] border-t-[var(--color-accent)]" />
          </div>
        )}

        {error && (
          <div className="rounded bg-[rgba(247,118,142,0.15)] px-3 py-2 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}

        {key && !loading && (
          <>
            {/* Metadata */}
            <div className="grid grid-cols-2 gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">Type</div>
                <div className="mt-0.5 font-medium text-[var(--color-text-primary)]">
                  {key.key_type.toUpperCase()}{key.bits ? ` ${key.bits}` : ''}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">Created</div>
                <div className="mt-0.5 font-medium text-[var(--color-text-primary)]">
                  {new Date(key.created_at).toLocaleDateString()}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">Fingerprint</div>
                <div className="mt-0.5 break-all font-mono text-[11px] text-[var(--color-text-primary)]">
                  {key.fingerprint}
                </div>
              </div>
            </div>

            {/* Public key */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--color-text-muted)]">Public Key</span>
                <button
                  type="button"
                  onClick={() => handleCopy(key.public_key, 'Public key')}
                  className="rounded px-2 py-0.5 text-[10px] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
                >
                  Copy
                </button>
              </div>
              <textarea
                readOnly
                value={key.public_key}
                className="input resize-none font-mono text-[11px]"
                rows={4}
                style={{ wordBreak: 'break-all' }}
              />
            </div>

            {/* Private key */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--color-text-muted)]">Private Key</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowPrivate((v) => !v)}
                    className="rounded px-2 py-0.5 text-[10px] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
                  >
                    {showPrivate ? 'Hide' : 'Show'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy(key.private_key, 'Private key')}
                    className="rounded px-2 py-0.5 text-[10px] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
                  >
                    Copy
                  </button>
                </div>
              </div>
              <textarea
                readOnly
                value={showPrivate ? key.private_key : maskedPrivateKey}
                className="input resize-none font-mono text-[11px]"
                rows={8}
                style={{
                  wordBreak: 'break-all',
                  filter: showPrivate ? 'none' : 'blur(0)',
                }}
              />
              {!showPrivate && (
                <p className="text-[10px] italic text-[var(--color-text-muted)]">
                  The private key is hidden for security. Click &ldquo;Show&rdquo; to reveal it.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default KeyDetailsDialog;
