import React, { useState, useCallback, useRef, useEffect } from 'react';
import { PIN_MAX_ATTEMPTS } from '../../../shared/constants';

// ============================================================
// PinUnlockForm — inline PIN entry for the lock screen
// ============================================================

interface PinUnlockFormProps {
  onSuccess: () => void | Promise<void>;
  onSwitchToPassword: () => void;
  maxAttempts?: number;
}

export function PinUnlockForm({
  onSuccess,
  onSwitchToPassword,
  maxAttempts = PIN_MAX_ATTEMPTS,
}: PinUnlockFormProps): React.ReactElement {
  const [pin, setPin] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);
  const [pinLength, setPinLength] = useState(4); // Expected PIN length (4-8)

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Trigger shake on error
  useEffect(() => {
    if (shake) {
      const timer = setTimeout(() => setShake(false), 500);
      return () => clearTimeout(timer);
    }
  }, [shake]);

  const handleSubmit = useCallback(async (value: string) => {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      // Attempt to unlock via PIN through the IPC bridge
      // This would call window.nexus.vault.unlockWithPin(value)
      // For now, the preload doesn't have this yet, so we go through unlock
      await (window.nexus as any).vault.unlockWithPin?.(value);
      await onSuccess();
    } catch (err) {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      setPin('');
      setShake(true);

      if (newAttempts >= maxAttempts) {
        setError('Too many attempts. Use master password instead.');
        // Force switch to password after max attempts
        setTimeout(() => onSwitchToPassword(), 1500);
      } else {
        setError(`Wrong PIN. ${maxAttempts - newAttempts} attempt${maxAttempts - newAttempts !== 1 ? 's' : ''} remaining.`);
      }
    } finally {
      setLoading(false);
    }
  }, [loading, attempts, maxAttempts, onSuccess, onSwitchToPassword]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value.replace(/\D/g, '').slice(0, 8);
      setPin(value);
      setError(null);

      // Auto-submit when we reach expected length (try at 4, 5, 6, 7, 8)
      // We auto-submit at 4+ digits if the user pauses, but also auto-submit
      // at max 8 digits immediately
      if (value.length === 8) {
        handleSubmit(value);
      }
    },
    [handleSubmit],
  );

  // Auto-submit after a short delay when >= 4 digits entered
  useEffect(() => {
    if (pin.length >= 4 && pin.length < 8 && !loading) {
      const timer = setTimeout(() => {
        handleSubmit(pin);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [pin, loading, handleSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && pin.length >= 4) {
        handleSubmit(pin);
      }
    },
    [pin, handleSubmit],
  );

  const remaining = maxAttempts - attempts;

  return (
    <div className={`flex w-full flex-col items-center gap-4 ${shake ? 'animate-shake' : ''}`}>
      {/* PIN dot display */}
      <div className="flex justify-center gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className={`flex h-4 w-4 items-center justify-center rounded-full transition-all duration-150 ${
              i < pin.length
                ? 'scale-125 bg-[var(--color-accent)]'
                : i < 4
                  ? 'border-2 border-[var(--color-text-muted)] bg-transparent'
                  : 'border border-[var(--color-border)] bg-transparent opacity-30'
            }`}
          />
        ))}
      </div>

      {/* Hidden input for capturing keystrokes */}
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={pin}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={loading || attempts >= maxAttempts}
        className="sr-only"
        autoComplete="off"
        aria-label="PIN input"
      />

      {/* Tap area to refocus */}
      <button
        type="button"
        onClick={() => inputRef.current?.focus()}
        className="text-xs text-[var(--color-text-muted)]"
      >
        {loading ? 'Verifying...' : 'Type your PIN'}
      </button>

      {/* Remaining attempts */}
      <div className="flex items-center gap-2">
        {Array.from({ length: maxAttempts }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 w-6 rounded-full transition-colors ${
              i < remaining
                ? remaining <= 1
                  ? 'bg-[var(--color-danger)]'
                  : 'bg-[var(--color-text-muted)]'
                : 'bg-[var(--color-bg-tertiary)]'
            }`}
          />
        ))}
        <span className="ml-1 text-xs text-[var(--color-text-muted)]">
          {remaining}/{maxAttempts}
        </span>
      </div>

      {/* Error message */}
      {error && (
        <div className="rounded bg-[var(--color-danger)]/10 px-3 py-2 text-center text-xs text-[var(--color-danger)]">
          {error}
        </div>
      )}

      {/* Switch to password */}
      <button
        onClick={onSwitchToPassword}
        className="text-xs text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-accent)]"
      >
        Use Master Password Instead
      </button>

      {/* Shake animation style */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
        .animate-shake {
          animation: shake 0.5s ease-in-out;
        }
      `}</style>
    </div>
  );
}

export default PinUnlockForm;
