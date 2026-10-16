import React, { useState, useCallback } from 'react';
import { Modal } from '../common/Modal';
import { FormField } from '../common/FormField';
import { useVaultStore } from '../../stores/vault-store';
import { useUIStore } from '../../stores/ui-store';
import type { KeyType, KeyGenerateOptions } from '../../../shared/types';
import { CircleCheck, CircleX, Copy, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { Icon } from '../common/Icon';

// ============================================================
// GenerateKeyDialog — Modal for generating a new SSH key
// ============================================================

interface GenerateKeyDialogProps {
  open: boolean;
  onClose: () => void;
}

type Stage = 'form' | 'generating' | 'success' | 'error';

const RSA_BIT_OPTIONS = [2048, 3072, 4096] as const;
const ECDSA_BIT_OPTIONS = [256, 384, 521] as const;

export const GenerateKeyDialog: React.FC<GenerateKeyDialogProps> = ({ open, onClose }) => {
  const addNotification = useUIStore((s) => s.addNotification);

  // Form state
  const [name, setName] = useState('');
  const [keyType, setKeyType] = useState<KeyType>('ed25519');
  const [rsaBits, setRsaBits] = useState<number>(4096);
  const [ecdsaBits, setEcdsaBits] = useState<number>(256);
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [comment, setComment] = useState('');

  // Generation state
  const [stage, setStage] = useState<Stage>('form');
  const [publicKey, setPublicKey] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const resetForm = useCallback(() => {
    setName('');
    setKeyType('ed25519');
    setRsaBits(4096);
    setEcdsaBits(256);
    setPassphrase('');
    setShowPassphrase(false);
    setComment('');
    setStage('form');
    setPublicKey('');
    setErrorMsg('');
    setCopied(false);
  }, []);

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleGenerate = async () => {
    if (!name.trim()) return;

    const vaultId = useVaultStore.getState().selectedVaultId;
    if (!vaultId) {
      setErrorMsg('No vault is currently unlocked. Please unlock a vault first.');
      setStage('error');
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

    setStage('generating');
    try {
      const result = (await window.nexus.keychain.generateKey(opts)) as { public_key?: string; publicKey?: string };
      setPublicKey(result.public_key || result.publicKey || '');
      await useVaultStore.getState().loadKeys();
      setStage('success');
      addNotification('success', `SSH key "${name}" generated successfully`);
    } catch (err) {
      setErrorMsg((err as Error).message);
      setStage('error');
    }
  };

  const handleCopyPublicKey = async () => {
    try {
      await navigator.clipboard.writeText(publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addNotification('error', 'Failed to copy to clipboard');
    }
  };

  const renderForm = () => (
    <div className="flex flex-col gap-4">
      <FormField label="Key Name" required>
        <input
          className="input"
          type="text"
          placeholder="e.g. My Server Key"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </FormField>

      <FormField label="Key Type">
        <div className="flex gap-2">
          {(['ed25519', 'rsa', 'ecdsa'] as KeyType[]).map((type) => (
            <label
              key={type}
              className="flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors"
              style={{
                borderColor: keyType === type ? 'var(--color-accent)' : 'var(--color-border)',
                backgroundColor: keyType === type ? 'var(--color-accent-muted)' : 'var(--color-bg-tertiary)',
              }}
            >
              <input
                type="radio"
                name="keyType"
                value={type}
                checked={keyType === type}
                onChange={() => setKeyType(type)}
                className="sr-only"
              />
              <span
                className="text-xs font-medium"
                style={{ color: keyType === type ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}
              >
                {type === 'ed25519' ? 'Ed25519' : type === 'rsa' ? 'RSA' : 'ECDSA'}
              </span>
              {type === 'ed25519' && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: 'rgba(158, 206, 106, 0.15)', color: 'var(--color-success)' }}
                >
                  Recommended
                </span>
              )}
            </label>
          ))}
        </div>
      </FormField>

      {/* Conditional bit size */}
      {keyType === 'rsa' && (
        <FormField label="Bit Size">
          <select
            className="input"
            value={rsaBits}
            onChange={(e) => setRsaBits(Number(e.target.value))}
          >
            {RSA_BIT_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {b} bits{b === 4096 ? ' (recommended)' : ''}
              </option>
            ))}
          </select>
        </FormField>
      )}

      {keyType === 'ecdsa' && (
        <FormField label="Curve Size">
          <select
            className="input"
            value={ecdsaBits}
            onChange={(e) => setEcdsaBits(Number(e.target.value))}
          >
            {ECDSA_BIT_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {b}{b === 256 ? ' (recommended)' : ''}
              </option>
            ))}
          </select>
        </FormField>
      )}

      <FormField label="Passphrase" helperText="Optional. Encrypts the private key at rest.">
        <div className="relative">
          <input
            className="input pr-10"
            type={showPassphrase ? 'text' : 'password'}
            placeholder="Leave empty for no passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 btn-ghost p-1 rounded"
            onClick={() => setShowPassphrase(!showPassphrase)}
            title={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
          >
            {showPassphrase ? (
              <Icon icon={EyeOff} size={14} color="var(--color-text-muted)" />
            ) : (
              <Icon icon={Eye} size={14} color="var(--color-text-muted)" />
            )}
          </button>
        </div>
      </FormField>

      <FormField label="Comment" helperText="Optional. Defaults to user@hostname if empty.">
        <input
          className="input"
          type="text"
          placeholder="user@hostname"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </FormField>
    </div>
  );

  const renderGenerating = () => (
    <div className="flex flex-col items-center justify-center py-10 gap-3">
      <Icon icon={LoaderCircle} size={32} color="var(--color-accent)" className="animate-spin" />
      <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Generating key...
      </span>
    </div>
  );

  const renderSuccess = () => (
    <div className="flex flex-col gap-4">
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-md"
        style={{ backgroundColor: 'rgba(158, 206, 106, 0.1)', border: '1px solid rgba(158, 206, 106, 0.3)' }}
      >
        <Icon icon={CircleCheck} size={16} color="var(--color-success)" />
        <span className="text-xs" style={{ color: 'var(--color-success)' }}>
          SSH key generated successfully
        </span>
      </div>

      <FormField label="Public Key">
        <textarea
          className="input font-mono text-xs"
          rows={5}
          readOnly
          value={publicKey}
          style={{ resize: 'none' }}
        />
      </FormField>

      <button className="btn btn-primary w-full" onClick={handleCopyPublicKey}>
        <Icon icon={Copy} size={14} />
        {copied ? 'Copied!' : 'Copy to Clipboard'}
      </button>

      <p className="text-xs text-center" style={{ color: 'var(--color-text-muted)' }}>
        The public key has been copied. Add it to your servers' authorized_keys file.
      </p>
    </div>
  );

  const renderError = () => (
    <div className="flex flex-col items-center gap-4 py-6">
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-md w-full"
        style={{ backgroundColor: 'rgba(247, 118, 142, 0.1)', border: '1px solid rgba(247, 118, 142, 0.3)' }}
      >
        <Icon icon={CircleX} size={16} color="var(--color-danger)" />
        <span className="text-xs" style={{ color: 'var(--color-danger)' }}>
          {errorMsg}
        </span>
      </div>
    </div>
  );

  const footer = (() => {
    switch (stage) {
      case 'form':
        return (
          <>
            <button className="btn btn-ghost" onClick={handleClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={!name.trim()}
            >
              Generate
            </button>
          </>
        );
      case 'success':
        return (
          <button className="btn btn-primary" onClick={handleClose}>
            Done
          </button>
        );
      case 'error':
        return (
          <>
            <button className="btn btn-ghost" onClick={handleClose}>
              Close
            </button>
            <button className="btn btn-primary" onClick={() => setStage('form')}>
              Try Again
            </button>
          </>
        );
      default:
        return null;
    }
  })();

  return (
    <Modal
      open={open}
      onClose={stage === 'generating' ? () => {} : handleClose}
      title="Generate SSH Key"
      footer={footer}
    >
      {stage === 'form' && renderForm()}
      {stage === 'generating' && renderGenerating()}
      {stage === 'success' && renderSuccess()}
      {stage === 'error' && renderError()}
    </Modal>
  );
};
