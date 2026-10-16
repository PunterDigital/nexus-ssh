import React, { useState, useCallback, useMemo } from 'react';
import { useVaultStore } from '../../stores';
import { Check, LockKeyhole, Usb } from 'lucide-react';
import { Icon } from '../common/Icon';
import { Button, Field, Input, PasswordInput, Textarea, cx } from '../ui';
import { LockCard, LockLayout, UnlockError } from './LockLayout';

// ============================================================
// CreateVaultDialog — full-screen vault creation flow (design system: #2366)
// ============================================================

type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong';

interface StrengthResult {
  level: PasswordStrength;
  score: number; // 0-4
  label: string;
}

export function calculatePasswordStrength(password: string): StrengthResult {
  if (!password) {
    return { level: 'weak', score: 0, label: 'Weak' };
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

  const varietyCount = [hasUpper, hasLower, hasNumbers, hasSymbols].filter(
    Boolean
  ).length;
  score += varietyCount;

  // Map raw score to levels: 0-2=weak, 3=fair, 4-5=good, 6+=strong
  if (score >= 6) return { level: 'strong', score: 4, label: 'Strong' };
  if (score >= 4) return { level: 'good', score: 3, label: 'Good' };
  if (score >= 3) return { level: 'fair', score: 2, label: 'Fair' };
  return { level: 'weak', score: 1, label: 'Weak' };
}

// Strength colours are status tokens, so they follow the theme.
const STRENGTH_TEXT: Record<PasswordStrength, string> = {
  weak: 'text-danger',
  fair: 'text-warning',
  good: 'text-success',
  strong: 'text-success',
};
const STRENGTH_FILL: Record<PasswordStrength, string> = {
  weak: 'bg-danger',
  fair: 'bg-warning',
  good: 'bg-success',
  strong: 'bg-success',
};

/** Four-segment meter: one segment per strength step. */
function StrengthMeter({ strength }: { strength: StrengthResult }): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-caption">
        <span className="text-fg-muted">Password strength</span>
        <span className={cx('font-medium', STRENGTH_TEXT[strength.level])}>
          {strength.label}
        </span>
      </div>
      <div
        className="grid grid-cols-4 gap-1"
        role="meter"
        aria-label="Password strength"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={strength.score}
        aria-valuetext={strength.label}
      >
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cx(
              'h-1 rounded-full transition-colors duration-(--duration-base) ease-standard',
              step <= strength.score ? STRENGTH_FILL[strength.level] : 'bg-surface-raised'
            )}
          />
        ))}
      </div>
    </div>
  );
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

  const displayError = localError || vaultError;
  const tooWeak = password.length > 0 && strength.score < 2;

  return (
    <LockLayout>
      <LockCard size="md" className="animate-slide-up">
        {/* Header */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Icon icon={LockKeyhole} size={24} />
          </div>
          <h1 className="text-heading font-semibold text-fg">Create New Vault</h1>
          <p className="text-body-sm text-fg-muted">
            Your vault encrypts all connections, keys, and credentials with Argon2id +
            SQLCipher.
          </p>
        </div>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
        >
          <Field label="Vault name" required>
            <Input
              value={vaultName}
              onChange={(e) => setVaultName(e.target.value)}
              placeholder="My Vault"
              autoFocus
              disabled={vaultLoading}
            />
          </Field>

          {/* Unlock method */}
          <label
            className={cx(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors duration-(--duration-fast)',
              useHardwareKey
                ? 'border-accent bg-accent-soft'
                : 'border-line bg-surface-sunken hover:border-line-strong'
            )}
          >
            <input
              type="checkbox"
              checked={useHardwareKey}
              onChange={(e) => setUseHardwareKey(e.target.checked)}
              disabled={vaultLoading}
              className="mt-0.5 size-4 shrink-0 cursor-pointer accent-accent focus-ring"
            />
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-body font-medium text-fg">
                <Icon icon={Usb} size={14} className="text-fg-muted" />
                Passwordless — unlock with hardware key
              </span>
              <span className="text-body-sm text-fg-muted">
                Use a FIDO2 security key (YubiKey 5+, Trezor Safe, etc.) as the only way
                to unlock this vault. The key never leaves your device, and the vault
                cannot be opened without it.
              </span>
            </span>
          </label>

          {useHardwareKey ? (
            <p className="rounded-md bg-surface-sunken px-3 py-2 text-body-sm text-fg-secondary">
              When you click{' '}
              <strong className="font-semibold text-fg">Create with Hardware Key</strong>,
              you'll be asked to insert and touch your security key. The key&apos;s PRF
              extension produces the encryption secret — losing the key means losing the
              vault, so consider enrolling a backup key later.
            </p>
          ) : (
            <>
              <Field
                label="Master password"
                required
                hint={
                  tooWeak
                    ? 'Too weak to use: add length (12+) and mix letters, numbers and symbols.'
                    : 'You need it to open the vault. It cannot be recovered.'
                }
              >
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Choose a strong password"
                  disabled={vaultLoading}
                  autoComplete="new-password"
                />
              </Field>
              {password.length > 0 && <StrengthMeter strength={strength} />}

              <Field
                label="Confirm password"
                required
                error={
                  confirmPassword.length > 0 && !passwordsMatch
                    ? 'Passwords do not match'
                    : undefined
                }
              >
                <PasswordInput
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your password"
                  disabled={vaultLoading}
                  autoComplete="new-password"
                />
              </Field>
              {passwordsMatch && (
                <p className="-mt-2 flex items-center gap-1 text-caption text-success">
                  <Icon icon={Check} size={12} />
                  Passwords match
                </p>
              )}
            </>
          )}

          <Field label="Description" hint="Optional.">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Personal servers, work infrastructure..."
              rows={2}
              disabled={vaultLoading}
              className="resize-none"
            />
          </Field>

          <UnlockError message={displayError} />

          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button variant="ghost" size="lg" onClick={onBack} disabled={vaultLoading}>
              Back
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={vaultLoading}
              disabled={!canCreate}
            >
              {vaultLoading
                ? useHardwareKey
                  ? 'Touch your key…'
                  : 'Creating…'
                : useHardwareKey
                  ? 'Create with Hardware Key'
                  : 'Create Vault'}
            </Button>
          </div>
        </form>
      </LockCard>
    </LockLayout>
  );
}

export default CreateVaultDialog;
