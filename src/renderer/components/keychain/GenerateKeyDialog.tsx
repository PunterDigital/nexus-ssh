import React, { useEffect, useId, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, Copy, Check } from 'lucide-react';
import { useVaultStore } from '../../stores/vault-store';
import { useUIStore } from '../../stores/ui-store';
import { Icon } from '../common/Icon';
import { Button, Dialog, Field, Input, PasswordInput, RadioGroup, Select, Textarea } from '../ui';
import type { RadioOption, SelectOption } from '../ui';
import type { KeyType, KeyGenerateOptions } from '../../../shared/types';

// ============================================================
// GenerateKeyDialog — generate a new SSH key pair (design system: #2367).
// A ui/Dialog form: validates on submit (error under the field), shows a failure in a banner
// above the form so the values can be fixed and tried again, and ends on the new public key.
// Mounted only while open, so it always starts from an empty form.
// ============================================================

interface GenerateKeyDialogProps {
  open: boolean;
  onClose: () => void;
}

type Stage = 'form' | 'generating' | 'success';

const KEY_TYPE_OPTIONS: RadioOption<KeyType>[] = [
  { value: 'ed25519', label: 'Ed25519' },
  { value: 'rsa', label: 'RSA' },
  { value: 'ecdsa', label: 'ECDSA' },
];

const KEY_TYPE_HINTS: Record<KeyType, string> = {
  ed25519: 'Recommended: small, fast and secure. Supported by OpenSSH 6.5 and later.',
  rsa: 'For older servers that don’t support Ed25519.',
  ecdsa: 'NIST curves, for servers that require them.',
};

const RSA_BIT_OPTIONS: SelectOption[] = [2048, 3072, 4096].map((b) => ({
  value: String(b),
  label: `${b} bits${b === 4096 ? ' (recommended)' : ''}`,
}));

const ECDSA_BIT_OPTIONS: SelectOption[] = [256, 384, 521].map((b) => ({
  value: String(b),
  label: `${b}${b === 256 ? ' (recommended)' : ''}`,
}));

export function GenerateKeyDialog(props: GenerateKeyDialogProps): React.ReactElement | null {
  if (!props.open) return null;
  return <GenerateKeyForm onClose={props.onClose} />;
}

function GenerateKeyForm({ onClose }: { onClose: () => void }): React.ReactElement {
  const addNotification = useUIStore((s) => s.addNotification);
  const formId = useId();
  const nameRef = useRef<HTMLInputElement>(null);

  // Form state
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [keyType, setKeyType] = useState<KeyType>('ed25519');
  const [rsaBits, setRsaBits] = useState<number>(4096);
  const [ecdsaBits, setEcdsaBits] = useState<number>(256);
  const [passphrase, setPassphrase] = useState('');
  const [comment, setComment] = useState('');

  // Generation state
  const [stage, setStage] = useState<Stage>('form');
  const [publicKey, setPublicKey] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const generating = stage === 'generating';

  // "Copied" goes back to "Copy" after 2 s (cleared if the dialog closes first).
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const handleGenerate = async () => {
    if (!name.trim()) {
      setNameError('Key name is required');
      nameRef.current?.focus();
      return;
    }

    const vaultId = useVaultStore.getState().selectedVaultId;
    if (!vaultId) {
      setErrorMsg('No vault is currently unlocked. Please unlock a vault first.');
      return;
    }

    const opts: KeyGenerateOptions & { vaultId: string } = {
      keyType,
      name: name.trim(),
      passphrase: passphrase || undefined,
      comment: comment || undefined,
      vaultId,
    };

    if (keyType === 'rsa') opts.bits = rsaBits;
    if (keyType === 'ecdsa') opts.bits = ecdsaBits;

    setErrorMsg('');
    setStage('generating');
    try {
      const result = (await window.nexus.keychain.generateKey(opts)) as { public_key?: string; publicKey?: string };
      setPublicKey(result.public_key || result.publicKey || '');
      await useVaultStore.getState().loadKeys();
      setStage('success');
      addNotification('success', `SSH key "${name}" generated successfully`);
    } catch (err) {
      setErrorMsg((err as Error).message);
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

  // Closing is blocked while ssh-keygen runs.
  const close = () => {
    if (!generating) onClose();
  };

  return (
    <Dialog
      open
      onClose={close}
      title="Generate SSH Key"
      dismissOnBackdrop={false}
      footer={
        stage === 'success' ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={generating}>
              Cancel
            </Button>
            <Button type="submit" form={formId} variant="primary" loading={generating}>
              Generate Key
            </Button>
          </>
        )
      }
    >
      {stage === 'success' ? (
        <div className="flex flex-col gap-4">
          <p role="status" className="flex items-start gap-2 rounded-md bg-success-soft px-3 py-2 text-body-sm text-success">
            <Icon icon={CircleCheck} className="mt-0.5" />
            SSH key “{name.trim()}” generated
          </p>
          <Field label="Public key" hint="Add it to ~/.ssh/authorized_keys on the servers you want to sign in to.">
            <Textarea code readOnly rows={4} value={publicKey} className="resize-none break-all" />
          </Field>
          <Button icon={copied ? Check : Copy} onClick={() => void handleCopyPublicKey()} className="self-start">
            {copied ? 'Copied' : 'Copy Public Key'}
          </Button>
        </div>
      ) : (
        <form
          id={formId}
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!generating) void handleGenerate();
          }}
        >
          {errorMsg && (
            <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-body-sm text-danger">
              <Icon icon={CircleAlert} className="mt-0.5" />
              <span className="min-w-0 break-words">{errorMsg}</span>
            </p>
          )}

          {/* disabled on the fieldset locks every field while the key is generated */}
          <fieldset disabled={generating} className="flex min-w-0 flex-col gap-4">
            <Field label="Key name" required error={nameError}>
              <Input
                ref={nameRef}
                placeholder="e.g. My Server Key"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(undefined);
                }}
                autoFocus
              />
            </Field>

            <div className="flex flex-col gap-1.5">
              <RadioGroup
                label="Key type"
                showLabel
                value={keyType}
                onChange={setKeyType}
                options={KEY_TYPE_OPTIONS}
              />
              <p className="text-caption text-fg-muted">{KEY_TYPE_HINTS[keyType]}</p>
            </div>

            {keyType === 'rsa' && (
              <Field label="Bit size">
                <Select
                  value={String(rsaBits)}
                  onChange={(e) => setRsaBits(Number(e.target.value))}
                  options={RSA_BIT_OPTIONS}
                />
              </Field>
            )}

            {keyType === 'ecdsa' && (
              <Field label="Curve size">
                <Select
                  value={String(ecdsaBits)}
                  onChange={(e) => setEcdsaBits(Number(e.target.value))}
                  options={ECDSA_BIT_OPTIONS}
                />
              </Field>
            )}

            <Field label="Passphrase" hint="Optional. Encrypts the private key at rest.">
              <PasswordInput
                placeholder="Leave empty for no passphrase"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </Field>

            <Field label="Comment" hint="Optional. Added to the end of the public key, e.g. user@hostname.">
              <Input
                code
                placeholder="user@hostname"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
              />
            </Field>
          </fieldset>
        </form>
      )}
    </Dialog>
  );
}
