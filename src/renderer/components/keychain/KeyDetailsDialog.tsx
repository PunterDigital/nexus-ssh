import React, { useCallback, useEffect, useState } from 'react';
import { CircleAlert, Copy, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { useUIStore } from '../../stores/ui-store';
import { Icon } from '../common/Icon';
import { Button, Dialog, Field, Textarea, cx } from '../ui';
import { keyTypeBadge } from './keyType';
import type { SSHKey } from '../../../shared/types';

// ============================================================
// KeyDetailsDialog — one SSH key's metadata, public key and (hidden until asked for) private
// key, each with a copy button (design system: #2367). Mounted only while a key is selected,
// so every key opens with its private key hidden.
// ============================================================

interface KeyDetailsDialogProps {
  keyId: string | null;
  onClose: () => void;
}

export function KeyDetailsDialog({ keyId, onClose }: KeyDetailsDialogProps): React.ReactElement | null {
  if (keyId === null) return null;
  // key={keyId}: switching straight to another key starts from a clean state.
  return <KeyDetails key={keyId} keyId={keyId} onClose={onClose} />;
}

function KeyDetails({ keyId, onClose }: { keyId: string; onClose: () => void }): React.ReactElement {
  const addNotification = useUIStore((s) => s.addNotification);
  const [key, setKey] = useState<SSHKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPrivate, setShowPrivate] = useState(false);

  // Load the full key (incl. private material) for this id.
  useEffect(() => {
    let cancelled = false;
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

  const maskedPrivateKey = key?.private_key ? key.private_key.replace(/[^\n]/g, '•') : '';
  const badge = key ? keyTypeBadge(key) : null;

  return (
    <Dialog
      open
      onClose={onClose}
      title={key ? key.name : 'Key Details'}
      size="lg"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {loading && (
          <p role="status" className="flex items-center justify-center gap-2 py-8 text-body text-fg-muted">
            <Icon icon={LoaderCircle} size={20} className="animate-spin text-accent" />
            Loading key…
          </p>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-body-sm text-danger">
            <Icon icon={CircleAlert} className="mt-0.5" />
            <span className="min-w-0 break-words">{error}</span>
          </p>
        )}

        {key && !loading && (
          <>
            {/* Metadata */}
            <dl className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface-sunken p-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-caption text-fg-muted">Type</dt>
                <dd>
                  <span className={cx('rounded-sm px-1.5 text-body-sm font-medium', badge?.className)}>
                    {badge?.label}
                  </span>
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-caption text-fg-muted">Created</dt>
                <dd className="text-body text-fg">{new Date(key.created_at).toLocaleDateString()}</dd>
              </div>
              <div className="col-span-2 flex min-w-0 flex-col gap-0.5">
                <dt className="text-caption text-fg-muted">Fingerprint</dt>
                <dd className="font-code text-body-sm break-all text-fg select-text">{key.fingerprint}</dd>
              </div>
            </dl>

            {/* Public key */}
            <Field
              label="Public key"
              aside={
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Copy}
                  aria-label="Copy public key"
                  onClick={() => void handleCopy(key.public_key, 'Public key')}
                >
                  Copy
                </Button>
              }
            >
              <Textarea code readOnly rows={3} value={key.public_key} className="resize-none break-all" />
            </Field>

            {/* Private key */}
            <Field
              label="Private key"
              hint={showPrivate ? undefined : 'Hidden for security. Select Show to reveal it.'}
              aside={
                <span className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={showPrivate ? EyeOff : Eye}
                    aria-label={showPrivate ? 'Hide private key' : 'Show private key'}
                    aria-pressed={showPrivate}
                    onClick={() => setShowPrivate((v) => !v)}
                  >
                    {showPrivate ? 'Hide' : 'Show'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Copy}
                    aria-label="Copy private key"
                    onClick={() => void handleCopy(key.private_key, 'Private key')}
                  >
                    Copy
                  </Button>
                </span>
              }
            >
              <Textarea
                code
                readOnly
                rows={6}
                value={showPrivate ? key.private_key : maskedPrivateKey}
                className="resize-none break-all"
              />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

export default KeyDetailsDialog;
