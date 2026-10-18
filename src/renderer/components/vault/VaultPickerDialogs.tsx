import React, { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button, Dialog, Field, Input } from '../ui';

// ============================================================
// Rename / delete a vault from the vault picker (#2646). Both work on a locked vault and need
// no password, so a vault whose password is forgotten can still be removed.
// ============================================================

export const vaultDisplayName = (file: string) =>
  (file.split(/[/\\]/).pop() ?? file).replace(/\.db$/, '');

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** What the OS calls its bin. */
const TRASH_NAME = navigator.platform?.startsWith('Mac') ? 'Trash' : 'Recycle Bin';

interface VaultDialogProps {
  /** The vault's path, or null when the dialog is closed. */
  vaultPath: string | null;
  onClose: () => void;
}

export function RenameVaultDialog({
  vaultPath,
  onClose,
  onRenamed,
}: VaultDialogProps & { onRenamed: (from: string, to: string) => void }): React.ReactElement | null {
  if (!vaultPath) return null;
  return <RenameVaultForm key={vaultPath} vaultPath={vaultPath} onClose={onClose} onRenamed={onRenamed} />;
}

function RenameVaultForm({
  vaultPath,
  onClose,
  onRenamed,
}: {
  vaultPath: string;
  onClose: () => void;
  onRenamed: (from: string, to: string) => void;
}): React.ReactElement {
  const current = vaultDisplayName(vaultPath);
  const [name, setName] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      setError('Enter a name for the vault');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await window.nexus.vault.rename(vaultPath, name);
      onRenamed(vaultPath, next);
    } catch (err) {
      setError(message(err));
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={() => !saving && onClose()}
      size="sm"
      title={`Rename ${current}`}
      description="Renames the vault's files. Its hardware-key unlock and sync settings stay with it."
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" icon={Pencil} loading={saving} onClick={() => void submit()}>
            Rename Vault
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Vault name" error={error ?? undefined}>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            maxLength={80}
            autoFocus
            disabled={saving}
          />
        </Field>
      </form>
    </Dialog>
  );
}

export function DeleteVaultDialog({
  vaultPath,
  onClose,
  onDeleted,
}: VaultDialogProps & { onDeleted: (vaultPath: string) => void }): React.ReactElement | null {
  if (!vaultPath) return null;
  return <DeleteVaultForm key={vaultPath} vaultPath={vaultPath} onClose={onClose} onDeleted={onDeleted} />;
}

function DeleteVaultForm({
  vaultPath,
  onClose,
  onDeleted,
}: {
  vaultPath: string;
  onClose: () => void;
  onDeleted: (vaultPath: string) => void;
}): React.ReactElement {
  const name = vaultDisplayName(vaultPath);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const confirmed = typed.trim() === name;

  const submit = async () => {
    if (!confirmed) return;
    setDeleting(true);
    setError(null);
    try {
      await window.nexus.vault.delete(vaultPath);
      onDeleted(vaultPath);
    } catch (err) {
      setError(message(err));
      setDeleting(false);
    }
  };

  return (
    <Dialog
      open
      onClose={() => !deleting && onClose()}
      size="sm"
      title={`Delete ${name}?`}
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={Trash2}
            loading={deleting}
            disabled={!confirmed}
            onClick={() => void submit()}
          >
            Delete Vault
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body-sm text-fg-secondary">
          <li>The vault&apos;s files go to the {TRASH_NAME}, so you can restore them from there.</li>
          <li>Its hardware-key unlock data goes with it.</li>
          <li>Copies synced to SFTP, FTP, S3 or a folder are not deleted.</li>
        </ul>
        <Field label={`Type "${name}" to confirm`} error={error ?? undefined}>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={name}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            disabled={deleting}
          />
        </Field>
      </form>
    </Dialog>
  );
}
