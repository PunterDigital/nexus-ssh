import React, { useState, useCallback, useMemo } from 'react';
import { useVaultStore, useUIStore } from '../../stores';
import { APP_NAME } from '../../../shared/constants';

// ============================================================
// CreateVaultDialog — full-screen vault creation flow
// ============================================================

type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong';

interface StrengthResult {
  level: PasswordStrength;
  score: number; // 0-4
  label: string;
  color: string;
}

function calculatePasswordStrength(password: string): StrengthResult {
  if (!password) {
    return { level: 'weak', score: 0, label: 'Weak', color: '#ff5555' };
  }

  let score = 0;

  // Length contributions
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;

  // Character variety
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumbers = /[0-9]/.test(password);
  const hasSymbols = /[^A-Za-z0-9]/.test(password);

  const varietyCount = [hasUpper, hasLower, hasNumbers, hasSymbols].filter(Boolean).length;
  score += varietyCount;

  // Map raw score to levels: 0-2=weak, 3=fair, 4-5=good, 6+=strong
  if (score >= 6) {
    return { level: 'strong', score: 4, label: 'Strong', color: '#50fa7b' };
  }
  if (score >= 4) {
    return { level: 'good', score: 3, label: 'Good', color: '#f1fa8c' };
  }
  if (score >= 3) {
    return { level: 'fair', score: 2, label: 'Fair', color: '#ffb86c' };
  }
  return { level: 'weak', score: 1, label: 'Weak', color: '#ff5555' };
}

interface CreateVaultDialogProps {
  onSuccess: () => void | Promise<void>;
  onBack: () => void;
}

export function CreateVaultDialog({
  onSuccess,
  onBack,
}: CreateVaultDialogProps): React.ReactElement {
  const createVault = useVaultStore((s) => s.createVault);
  const createPasswordlessVault = useVaultStore((s) => s.createPasswordlessVault);
  const vaultLoading = useVaultStore((s) => s.loading);
  const vaultError = useVaultStore((s) => s.error);

  const [vaultName, setVaultName] = useState('');
  const [useHardwareKey, setUseHardwareKey] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [description, setDescription] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const strength = useMemo(() => calculatePasswordStrength(password), [password]);

  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;
  const canCreate = useHardwareKey
    ? vaultName.trim().length > 0 && !vaultLoading
    : vaultName.trim().length > 0 &&
      passwordsMatch &&
      strength.score >= 2 && // at least "fair"
      !vaultLoading;

  const handleCreate = useCallback(async () => {
    if (!canCreate) return;
    setLocalError(null);

    try {
      if (useHardwareKey) {
        await createPasswordlessVault(vaultName.trim());
        await onSuccess();
        return;
      }

      if (password !== confirmPassword) {
        setLocalError('Passwords do not match');
        return;
      }

      await createVault(password, vaultName.trim() || undefined);
      await onSuccess();
    } catch {
      // Error displayed from store
    }
  }, [
    canCreate,
    useHardwareKey,
    vaultName,
    password,
    confirmPassword,
    createVault,
    createPasswordlessVault,
    onSuccess,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && canCreate) handleCreate();
    },
    [canCreate, handleCreate],
  );

  const displayError = localError || vaultError;

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-bg-secondary)]">
      <div className="w-[460px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-8 shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-accent)]/15">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-[var(--color-text-primary)]">
            Create New Vault
          </h2>
          <p className="text-center text-xs text-[var(--color-text-muted)]">
            Your vault encrypts all connections, keys, and credentials with Argon2id + SQLCipher.
          </p>
        </div>

        {/* Form */}
        <div className="flex flex-col gap-4" onKeyDown={handleKeyDown}>
          {/* Vault name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
              Vault Name
            </label>
            <input
              type="text"
              value={vaultName}
              onChange={(e) => setVaultName(e.target.value)}
              placeholder="My Vault"
              autoFocus
              disabled={vaultLoading}
              className="input"
            />
          </div>

          {/* Unlock method toggle */}
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={useHardwareKey}
                onChange={(e) => setUseHardwareKey(e.target.checked)}
                disabled={vaultLoading}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--color-accent)]"
              />
              <div className="flex-1">
                <div className="text-xs font-semibold text-[var(--color-text-primary)]">
                  Passwordless — unlock with hardware key
                </div>
                <div className="mt-0.5 text-[11px] leading-snug text-[var(--color-text-muted)]">
                  Use a FIDO2 security key (YubiKey 5+, Trezor Safe, etc.) as the only
                  way to unlock this vault. The key never leaves your device, and the
                  vault cannot be opened without it.
                </div>
              </div>
            </label>
          </div>

          {/* Master password */}
          {!useHardwareKey && (
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
              Master Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Choose a strong password"
                disabled={vaultLoading}
                className="input pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
                tabIndex={-1}
              >
                <ToggleEyeIcon show={showPassword} />
              </button>
            </div>

            {/* Strength meter */}
            {password.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 flex justify-between">
                  <span className="text-xs text-[var(--color-text-muted)]">
                    Password strength
                  </span>
                  <span className="text-xs font-medium" style={{ color: strength.color }}>
                    {strength.label}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
                  <div
                    className="h-full rounded-full transition-all duration-300 ease-out"
                    style={{
                      width: `${(strength.score / 4) * 100}%`,
                      backgroundColor: strength.color,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
          )}

          {/* Confirm password */}
          {!useHardwareKey && (
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
              Confirm Password
            </label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat your password"
                disabled={vaultLoading}
                className="input pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
                tabIndex={-1}
              >
                <ToggleEyeIcon show={showConfirm} />
              </button>
            </div>
            {confirmPassword.length > 0 && !passwordsMatch && (
              <p className="mt-1 text-xs text-[var(--color-danger)]">
                Passwords do not match
              </p>
            )}
            {passwordsMatch && (
              <p className="mt-1 text-xs text-[var(--color-success)]">
                Passwords match
              </p>
            )}
          </div>
          )}

          {useHardwareKey && (
            <div className="rounded bg-[var(--color-accent)]/10 px-3 py-2 text-[11px] leading-snug text-[var(--color-text-secondary)]">
              When you click <strong>Create Vault</strong>, your browser will ask
              you to insert and touch your security key. The key&apos;s PRF
              extension produces the encryption secret — losing the key means
              losing the vault, so consider enrolling a backup key later.
            </div>
          )}

          {/* Description (optional) */}
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
              Description{' '}
              <span className="text-[var(--color-text-muted)]">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Personal servers, work infrastructure..."
              rows={2}
              disabled={vaultLoading}
              className="input resize-none"
            />
          </div>

          {/* Error display */}
          {displayError && (
            <div className="rounded bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
              {displayError}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={onBack}
              disabled={vaultLoading}
              className="btn btn-ghost flex-1 py-2.5"
            >
              Back
            </button>
            <button
              onClick={handleCreate}
              disabled={!canCreate}
              className="btn btn-primary flex-1 py-2.5"
            >
              {vaultLoading ? (
                <span className="flex items-center gap-2">
                  <SpinnerSmall />
                  {useHardwareKey ? 'Touch your key...' : 'Creating...'}
                </span>
              ) : useHardwareKey ? (
                'Create with Hardware Key'
              ) : (
                'Create Vault'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helper components ────────────────────────────────────────

function ToggleEyeIcon({ show }: { show: boolean }): React.ReactElement {
  if (show) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.6 6.6a2 2 0 0 0 2.8 2.8" />
        <path d="M1 1l14 14" />
        <path d="M4.3 4.3C2.6 5.5 1 8 1 8s2.5 5 7 5c1.3 0 2.5-.4 3.5-1" />
        <path d="M13 11.7C14.3 10.4 15 8 15 8s-2.5-5-7-5c-.5 0-1 .1-1.5.2" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function SpinnerSmall(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeDasharray="31.4 31.4"
        strokeLinecap="round"
        opacity="0.3"
      />
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeDasharray="15.7 47.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default CreateVaultDialog;
