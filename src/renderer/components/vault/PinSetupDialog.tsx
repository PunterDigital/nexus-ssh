import React, { useState, useCallback, useRef, useEffect } from 'react';

// ============================================================
// PinSetupDialog — modal for setting up PIN quick-unlock
// ============================================================

interface PinSetupDialogProps {
  onSetPin: (pin: string) => void | Promise<void>;
  onSkip: () => void;
}

export function PinSetupDialog({
  onSetPin,
  onSkip,
}: PinSetupDialogProps): React.ReactElement {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  const isValidPin = (value: string) => /^\d{4,8}$/.test(value);

  const handlePinChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value.replace(/\D/g, '').slice(0, 8);
      setError(null);

      if (step === 'enter') {
        setPin(value);
      } else {
        setConfirmPin(value);
      }
    },
    [step],
  );

  const handleNext = useCallback(() => {
    if (step === 'enter') {
      if (!isValidPin(pin)) {
        setError('PIN must be 4-8 digits');
        return;
      }
      setStep('confirm');
      setConfirmPin('');
    }
  }, [step, pin]);

  const handleConfirm = useCallback(async () => {
    if (pin !== confirmPin) {
      setError('PINs do not match');
      setConfirmPin('');
      return;
    }

    setLoading(true);
    try {
      await onSetPin(pin);
    } catch (err) {
      setError((err as Error).message || 'Failed to set PIN');
      setLoading(false);
    }
  }, [pin, confirmPin, onSetPin]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (step === 'enter' && isValidPin(pin)) {
          handleNext();
        } else if (step === 'confirm' && isValidPin(confirmPin)) {
          handleConfirm();
        }
      }
    },
    [step, pin, confirmPin, handleNext, handleConfirm],
  );

  const currentValue = step === 'enter' ? pin : confirmPin;

  return (
    <div className="modal-overlay">
      <div className="modal-content w-[380px] p-6">
        {/* Header */}
        <div className="mb-5 flex flex-col items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-accent)]/15">
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="1" width="14" height="18" rx="2" />
              {/* Keypad dots */}
              <circle cx="7" cy="9" r="0.8" fill="var(--color-accent)" />
              <circle cx="10" cy="9" r="0.8" fill="var(--color-accent)" />
              <circle cx="13" cy="9" r="0.8" fill="var(--color-accent)" />
              <circle cx="7" cy="12" r="0.8" fill="var(--color-accent)" />
              <circle cx="10" cy="12" r="0.8" fill="var(--color-accent)" />
              <circle cx="13" cy="12" r="0.8" fill="var(--color-accent)" />
              <circle cx="10" cy="15" r="0.8" fill="var(--color-accent)" />
              <rect x="4" y="3" width="12" height="3" rx="0.5" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
            Set Up Quick Unlock
          </h3>
          <p className="text-center text-xs text-[var(--color-text-muted)]">
            {step === 'enter'
              ? 'Choose a 4-8 digit PIN for fast vault access'
              : 'Confirm your PIN'}
          </p>
        </div>

        {/* PIN visual dots */}
        <div className="mb-4 flex justify-center gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className={`h-3 w-3 rounded-full transition-all duration-150 ${
                i < currentValue.length
                  ? 'scale-110 bg-[var(--color-accent)]'
                  : i < 4
                    ? 'border border-[var(--color-border)] bg-transparent'
                    : 'border border-[var(--color-border)] bg-transparent opacity-40'
              }`}
            />
          ))}
        </div>

        {/* Hidden numeric input */}
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={currentValue}
          onChange={handlePinChange}
          onKeyDown={handleKeyDown}
          className="input mb-2 text-center text-lg tracking-[0.5em]"
          placeholder={step === 'enter' ? 'Enter PIN' : 'Confirm PIN'}
          disabled={loading}
          autoComplete="off"
          style={{ caretColor: 'var(--color-accent)' }}
        />

        {/* Length indicator */}
        <div className="mb-4 text-center text-xs text-[var(--color-text-muted)]">
          {currentValue.length}/8 digits (min 4)
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded bg-[var(--color-danger)]/10 px-3 py-2 text-center text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onSkip}
            disabled={loading}
            className="btn btn-ghost flex-1 py-2"
          >
            Skip
          </button>
          {step === 'enter' ? (
            <button
              onClick={handleNext}
              disabled={!isValidPin(pin)}
              className="btn btn-primary flex-1 py-2"
            >
              Next
            </button>
          ) : (
            <div className="flex flex-1 gap-2">
              <button
                onClick={() => {
                  setStep('enter');
                  setConfirmPin('');
                  setError(null);
                }}
                disabled={loading}
                className="btn btn-ghost flex-1 py-2"
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={!isValidPin(confirmPin) || loading}
                className="btn btn-primary flex-1 py-2"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <SmallSpinner />
                    Setting...
                  </span>
                ) : (
                  'Set PIN'
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SmallSpinner(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" opacity="0.3" />
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="15.7 47.1" strokeLinecap="round" />
    </svg>
  );
}

export default PinSetupDialog;
