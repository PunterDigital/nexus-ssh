import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, CircleAlert, CircleCheck, Copy, FolderOpen } from 'lucide-react';
import { useVaultStore } from '../../stores/vault-store';
import { useUIStore } from '../../stores/ui-store';
import { Icon } from '../common/Icon';
import { Button, Dialog, Field, Input, PasswordInput, RadioGroup, Textarea, cx } from '../ui';
import type { RadioOption } from '../ui';

// ============================================================
// ImportKeyDialog — import an existing private key from a file or pasted text (design system:
// #2367). A ui/Dialog form: validates on submit (errors under the fields), shows a failure in
// a banner above the form (an encrypted key also reveals the passphrase field), and ends on
// the key's public key. Mounted only while open, so it always starts from an empty form.
// ============================================================

interface ImportKeyDialogProps {
  open: boolean;
  onClose: () => void;
}

type ImportMode = 'file' | 'clipboard';
type Stage = 'form' | 'importing' | 'success';
type Errors = Partial<Record<'name' | 'file' | 'content', string>>;

const MODE_OPTIONS: RadioOption<ImportMode>[] = [
  { value: 'file', label: 'From file' },
  { value: 'clipboard', label: 'Paste key' },
];

/** Whether pasted key text looks encrypted (then the passphrase field is shown). */
function looksEncrypted(content: string): boolean {
  return content.includes('ENCRYPTED') || content.includes('DEK-Info');
}

export function ImportKeyDialog(props: ImportKeyDialogProps): React.ReactElement | null {
  if (!props.open) return null;
  return <ImportKeyForm onClose={props.onClose} />;
}

function ImportKeyForm({ onClose }: { onClose: () => void }): React.ReactElement {
  const addNotification = useUIStore((s) => s.addNotification);
  const formId = useId();
  const fileLabelId = useId();
  const fileMessageId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  // Form state
  const [mode, setMode] = useState<ImportMode>('file');
  const [name, setName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [clipboardContent, setClipboardContent] = useState('');
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  // Bumped on each failed submit: focuses the first invalid field once it has rendered.
  const [invalidSubmits, setInvalidSubmits] = useState(0);

  // Import state
  const [stage, setStage] = useState<Stage>('form');
  const [publicKey, setPublicKey] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const importing = stage === 'importing';

  useEffect(() => {
    if (invalidSubmits === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [invalidSubmits]);

  // "Copied" goes back to "Copy" after 2 s (cleared if the dialog closes first).
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const clearError = (field: keyof Errors) => {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleClipboardContentChange = (content: string) => {
    setClipboardContent(content);
    clearError('content');
    if (looksEncrypted(content)) setNeedsPassphrase(true);
  };

  const handleSelectFile = async () => {
    try {
      const result = await window.nexus.fs.pickFile({
        title: 'Select SSH Key File',
        filters: [
          { name: 'SSH Keys', extensions: ['pem', 'key', 'ppk'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result && result.filePaths && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        setSelectedFilePath(filePath);
        clearError('file');
        // Extract filename for display
        const parts = filePath.replace(/\\/g, '/').split('/');
        setSelectedFileName(parts[parts.length - 1] || filePath);

        // Auto-fill name if empty
        if (!name) {
          const baseName = (parts[parts.length - 1] || '').replace(/\.(pem|key|ppk)$/, '');
          setName(baseName);
          clearError('name');
        }
      }
    } catch (err) {
      addNotification('error', `Failed to select file: ${(err as Error).message}`);
    }
  };

  const validate = (): boolean => {
    const e: Errors = {};
    if (mode === 'file' && !selectedFilePath) e.file = 'Choose a key file to import';
    if (mode === 'clipboard' && !clipboardContent.trim()) e.content = 'Paste a private key to import';
    if (!name.trim()) e.name = 'Key name is required';
    setErrors(e);
    if (Object.keys(e).length === 0) return true;
    setInvalidSubmits((n) => n + 1);
    return false;
  };

  const handleImport = async () => {
    if (!validate()) return;

    const vaultId = useVaultStore.getState().selectedVaultId;
    if (!vaultId) {
      setErrorMsg('No vault is currently unlocked. Please unlock a vault first.');
      return;
    }

    setErrorMsg('');
    setStage('importing');
    try {
      const result =
        mode === 'file'
          ? await window.nexus.keychain.importKey({
              source: 'file',
              filePath: selectedFilePath,
              name: name.trim(),
              passphrase: passphrase || undefined,
              vaultId,
            })
          : await window.nexus.keychain.importKey({
              source: 'clipboard',
              content: clipboardContent,
              name: name.trim(),
              passphrase: passphrase || undefined,
              vaultId,
            });

      // The handler returns the saved key (snake_case) without its private material.
      const imported = result as { public_key?: string; publicKey?: string };
      setPublicKey(imported.public_key || imported.publicKey || '');
      await useVaultStore.getState().loadKeys();
      setStage('success');
      addNotification('success', `SSH key "${name}" imported successfully`);
    } catch (err) {
      const message = (err as Error).message;
      // Check if the error is about needing a passphrase
      if (message.toLowerCase().includes('passphrase') || message.toLowerCase().includes('encrypted')) {
        setNeedsPassphrase(true);
        setErrorMsg('This key is encrypted. Please provide the passphrase.');
      } else {
        setErrorMsg(message);
      }
      setStage('form');
    }
  };

  const handleCopyPublicKey = async () => {
    try {
      await navigator.clipboard.writeText(publicKey);
      setCopied(true);
    } catch {
      addNotification('error', 'Failed to copy to clipboard');
    }
  };

  // Closing is blocked while the import runs.
  const close = () => {
    if (!importing) onClose();
  };

  return (
    <Dialog
      open
      onClose={close}
      title="Import SSH Key"
      dismissOnBackdrop={false}
      footer={
        stage === 'success' ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={importing}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="primary" loading={importing}>
              Import Key
            </Button>
          </>
        )
      }
    >
      {stage === 'success' ? (
        <div className="flex flex-col gap-4">
          <p role="status" className="flex items-start gap-2 rounded-md bg-success-soft px-3 py-2 text-body-sm text-success">
            <Icon icon={CircleCheck} className="mt-0.5" />
            SSH key “{name.trim()}” imported
          </p>
          {publicKey && (
            <>
              <Field label="Public key" hint="Add it to ~/.ssh/authorized_keys on the servers you want to sign in to.">
                <Textarea code readOnly rows={4} value={publicKey} className="resize-none break-all" />
              </Field>
              <Button icon={copied ? Check : Copy} onClick={() => void handleCopyPublicKey()} className="self-start">
                {copied ? 'Copied' : 'Copy Public Key'}
              </Button>
            </>
          )}
        </div>
      ) : (
        <form
          id={formId}
          ref={formRef}
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!importing) void handleImport();
          }}
        >
          {errorMsg && (
            <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-body-sm text-danger">
              <Icon icon={CircleAlert} className="mt-0.5" />
              <span className="min-w-0 break-words">{errorMsg}</span>
            </p>
          )}

          {/* disabled on the fieldset locks every field while the key is imported */}
          <fieldset disabled={importing} className="flex min-w-0 flex-col gap-4">
            <RadioGroup
              label="Import from"
              showLabel
              value={mode}
              onChange={(m) => {
                setMode(m);
                setErrors((prev) => ({ ...prev, file: undefined, content: undefined }));
              }}
              options={MODE_OPTIONS}
            />

            {mode === 'file' ? (
              <div role="group" aria-labelledby={fileLabelId} className="flex flex-col gap-1.5">
                <span id={fileLabelId} className="text-body-sm font-medium text-fg-secondary">
                  Key file
                </span>
                <div className="flex min-w-0 items-center gap-3">
                  <Button
                    icon={FolderOpen}
                    onClick={() => void handleSelectFile()}
                    aria-invalid={errors.file ? true : undefined}
                    aria-describedby={errors.file ? fileMessageId : undefined}
                    className={cx(errors.file && 'border-danger')}
                  >
                    Choose File…
                  </Button>
                  <span
                    className={cx(
                      'min-w-0 truncate text-body-sm',
                      selectedFileName ? 'font-code text-fg' : 'text-fg-muted',
                    )}
                    title={selectedFilePath || undefined}
                  >
                    {selectedFileName || 'No file chosen'}
                  </span>
                </div>
                {errors.file ? (
                  <p id={fileMessageId} className="text-caption text-danger">
                    {errors.file}
                  </p>
                ) : (
                  <p className="text-caption text-fg-muted">A .pem, .key or .ppk file, or id_rsa, id_ed25519 and similar.</p>
                )}
              </div>
            ) : (
              <Field label="Private key" error={errors.content}>
                <Textarea
                  code
                  rows={6}
                  placeholder="Paste your private key here (-----BEGIN OPENSSH PRIVATE KEY-----)"
                  value={clipboardContent}
                  onChange={(e) => handleClipboardContentChange(e.target.value)}
                  spellCheck={false}
                  className="break-all"
                />
              </Field>
            )}

            <Field label="Key name" required error={errors.name}>
              <Input
                placeholder="e.g. Production Server Key"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearError('name');
                }}
              />
            </Field>

            {needsPassphrase ? (
              <Field label="Passphrase" hint="Needed if the key is encrypted.">
                <PasswordInput
                  placeholder="Enter key passphrase"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
              </Field>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setNeedsPassphrase(true)} className="-ml-2 self-start">
                Key has a passphrase?
              </Button>
            )}

            <p className="text-caption text-fg-muted">Supports OpenSSH, PEM/PKCS#8, and PuTTY PPK formats.</p>
          </fieldset>
        </form>
      )}
    </Dialog>
  );
}
