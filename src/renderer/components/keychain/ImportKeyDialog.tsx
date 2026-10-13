import React, { useState, useCallback } from 'react';
import { Modal } from '../common/Modal';
import { FormField } from '../common/FormField';
import { useVaultStore } from '../../stores/vault-store';
import { useUIStore } from '../../stores/ui-store';

// ============================================================
// ImportKeyDialog — Modal for importing an SSH key
// ============================================================

interface ImportKeyDialogProps {
  open: boolean;
  onClose: () => void;
}

type ImportMode = 'file' | 'clipboard';
type Stage = 'form' | 'importing' | 'success' | 'error';

export const ImportKeyDialog: React.FC<ImportKeyDialogProps> = ({ open, onClose }) => {
  const addNotification = useUIStore((s) => s.addNotification);

  // Form state
  const [mode, setMode] = useState<ImportMode>('file');
  const [name, setName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [clipboardContent, setClipboardContent] = useState('');
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');

  // Import state
  const [stage, setStage] = useState<Stage>('form');
  const [publicKey, setPublicKey] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [needsPassphrase, setNeedsPassphrase] = useState(false);

  const resetForm = useCallback(() => {
    setMode('file');
    setName('');
    setPassphrase('');
    setShowPassphrase(false);
    setClipboardContent('');
    setSelectedFilePath('');
    setSelectedFileName('');
    setStage('form');
    setPublicKey('');
    setErrorMsg('');
    setCopied(false);
    setNeedsPassphrase(false);
  }, []);

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Auto-detect if key content looks encrypted
  const detectEncrypted = (content: string): boolean => {
    return content.includes('ENCRYPTED') || content.includes('DEK-Info');
  };

  const handleClipboardContentChange = (content: string) => {
    setClipboardContent(content);
    if (detectEncrypted(content)) {
      setNeedsPassphrase(true);
    }
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
        // Extract filename for display
        const parts = filePath.replace(/\\/g, '/').split('/');
        setSelectedFileName(parts[parts.length - 1] || filePath);

        // Auto-fill name if empty
        if (!name) {
          const baseName = (parts[parts.length - 1] || '').replace(/\.(pem|key|ppk)$/, '');
          setName(baseName);
        }
      }
    } catch (err) {
      addNotification('error', `Failed to select file: ${(err as Error).message}`);
    }
  };

  const handleImport = async () => {
    if (!name.trim()) return;

    const vaultId = useVaultStore.getState().selectedVaultId;
    if (!vaultId) {
      setErrorMsg('No vault is currently unlocked. Please unlock a vault first.');
      setStage('error');
      return;
    }

    setStage('importing');
    try {
      let result: unknown;
      if (mode === 'file') {
        if (!selectedFilePath) {
          setErrorMsg('Please select a file first');
          setStage('error');
          return;
        }
        result = await window.nexus.keychain.importKey({
          source: 'file',
          filePath: selectedFilePath,
          name: name.trim(),
          passphrase: passphrase || undefined,
          vaultId,
        });
      } else {
        if (!clipboardContent.trim()) {
          setErrorMsg('Please paste a private key');
          setStage('error');
          return;
        }
        result = await window.nexus.keychain.importKey({
          source: 'clipboard',
          content: clipboardContent,
          name: name.trim(),
          passphrase: passphrase || undefined,
          vaultId,
        });
      }

      const imported = result as { publicKey?: string };
      setPublicKey(imported.publicKey || '');
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
      {/* Mode tabs */}
      <div
        className="flex rounded-md overflow-hidden border"
        style={{ borderColor: 'var(--color-border)' }}
      >
        {(['file', 'clipboard'] as ImportMode[]).map((m) => (
          <button
            key={m}
            className="flex-1 px-4 py-2 text-xs font-medium transition-colors"
            style={{
              backgroundColor: mode === m ? 'var(--color-accent-muted)' : 'var(--color-bg-tertiary)',
              color: mode === m ? 'var(--color-accent)' : 'var(--color-text-muted)',
              borderRight: m === 'file' ? '1px solid var(--color-border)' : 'none',
            }}
            onClick={() => setMode(m)}
          >
            {m === 'file' ? 'From File' : 'From Clipboard'}
          </button>
        ))}
      </div>

      {/* File picker or textarea */}
      {mode === 'file' ? (
        <FormField label="Key File">
          <button
            className="input text-left flex items-center gap-2 cursor-pointer"
            onClick={handleSelectFile}
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5">
              <path d="M2 7V3a1 1 0 011-1h3l2 2h3a1 1 0 011 1v2" />
              <path d="M1.5 7h11a1 1 0 01.98 1.2l-1 5A1 1 0 0111.5 14h-9a1 1 0 01-.98-.8l-1-5A1 1 0 011.5 7z" />
            </svg>
            <span
              className="text-xs truncate"
              style={{ color: selectedFileName ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}
            >
              {selectedFileName || 'Select .pem, .key, id_rsa, id_ed25519, or .ppk file...'}
            </span>
          </button>
        </FormField>
      ) : (
        <FormField label="Private Key Content">
          <textarea
            className="input font-mono text-xs"
            rows={8}
            placeholder="Paste your private key here (-----BEGIN OPENSSH PRIVATE KEY-----)"
            value={clipboardContent}
            onChange={(e) => handleClipboardContentChange(e.target.value)}
            style={{ resize: 'vertical' }}
          />
        </FormField>
      )}

      <FormField label="Key Name" required>
        <input
          className="input"
          type="text"
          placeholder="e.g. Production Server Key"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </FormField>

      {/* Passphrase (always shown when key may be encrypted) */}
      {needsPassphrase && (
        <FormField label="Passphrase" helperText="This key appears to be encrypted.">
          <div className="relative">
            <input
              className="input pr-10"
              type={showPassphrase ? 'text' : 'password'}
              placeholder="Enter key passphrase"
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
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.2">
                  <path d="M1 1l12 12" />
                  <path d="M5.6 5.6a2 2 0 002.8 2.8" />
                  <path d="M3 4.5C1.8 5.5 1 7 1 7s2 4 6 4c.8 0 1.5-.15 2.1-.4" />
                  <path d="M10.5 9.8C12 8.7 13 7 13 7s-2-4-6-4c-.5 0-1 .07-1.4.17" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.2">
                  <ellipse cx="7" cy="7" rx="6" ry="4" />
                  <circle cx="7" cy="7" r="2" />
                </svg>
              )}
            </button>
          </div>
        </FormField>
      )}

      {/* Always show a passphrase field option */}
      {!needsPassphrase && (
        <button
          className="text-xs self-start"
          style={{ color: 'var(--color-text-muted)' }}
          onClick={() => setNeedsPassphrase(true)}
          type="button"
        >
          Key has a passphrase?
        </button>
      )}

      {/* Supported formats note */}
      <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
        Supports OpenSSH, PEM/PKCS#8, and PuTTY PPK formats
      </p>
    </div>
  );

  const renderImporting = () => (
    <div className="flex flex-col items-center justify-center py-10 gap-3">
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="2"
        className="animate-spin"
      >
        <circle cx="16" cy="16" r="12" opacity="0.25" />
        <path d="M16 4a12 12 0 019 18" />
      </svg>
      <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Importing key...
      </span>
    </div>
  );

  const renderSuccess = () => (
    <div className="flex flex-col gap-4">
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-md"
        style={{ backgroundColor: 'rgba(158, 206, 106, 0.1)', border: '1px solid rgba(158, 206, 106, 0.3)' }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--color-success)" strokeWidth="1.5">
          <circle cx="8" cy="8" r="6" />
          <polyline points="5.5,8 7,9.5 10.5,6" />
        </svg>
        <span className="text-xs" style={{ color: 'var(--color-success)' }}>
          SSH key imported successfully
        </span>
      </div>

      {publicKey && (
        <>
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
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="4" y="4" width="8" height="8" rx="1.5" />
              <path d="M10 4V2.5A1.5 1.5 0 008.5 1H2.5A1.5 1.5 0 001 2.5v6A1.5 1.5 0 002.5 10H4" />
            </svg>
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
        </>
      )}
    </div>
  );

  const renderError = () => (
    <div className="flex flex-col gap-4">
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-md"
        style={{ backgroundColor: 'rgba(247, 118, 142, 0.1)', border: '1px solid rgba(247, 118, 142, 0.3)' }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--color-danger)" strokeWidth="1.5">
          <circle cx="8" cy="8" r="6" />
          <line x1="6" y1="6" x2="10" y2="10" />
          <line x1="10" y1="6" x2="6" y2="10" />
        </svg>
        <span className="text-xs" style={{ color: 'var(--color-danger)' }}>
          {errorMsg}
        </span>
      </div>
    </div>
  );

  const canImport =
    name.trim() && (mode === 'file' ? !!selectedFilePath : !!clipboardContent.trim());

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
              onClick={handleImport}
              disabled={!canImport}
            >
              Import
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
      onClose={stage === 'importing' ? () => {} : handleClose}
      title="Import SSH Key"
      footer={footer}
    >
      {stage === 'form' && renderForm()}
      {stage === 'importing' && renderImporting()}
      {stage === 'success' && renderSuccess()}
      {stage === 'error' && renderError()}
    </Modal>
  );
};
