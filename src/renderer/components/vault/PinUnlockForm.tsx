import React, { useEffect, useRef, useState } from 'react';
import { useVaultStore } from '../../stores';
import { Button, Field, Input } from '../ui';

// ============================================================
// PinUnlockForm — PIN entry on the lock screen (#2653). Main checks the PIN and counts wrong
// tries; after the last one it turns PIN unlock off and the lock screen shows the method picker.
// ============================================================

/** Keep digits only, at most 8. */
export const pinDigits = (value: string) => value.replace(/\D/g, '').slice(0, 8);

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface PinUnlockFormProps {
  vaultPath: string;
  onUnlocked: () => void | Promise<void>;
  /** PIN unlock was turned off by the last wrong try (or no longer matches the vault). */
  onPinDisabled: (message: string) => void;
  onUseAnotherMethod: () => void;
}

export function PinUnlockForm({
  vaultPath,
  onUnlocked,
  onPinDisabled,
  onUseAnotherMethod,
}: PinUnlockFormProps): React.ReactElement {
  const unlockWithPin = useVaultStore((s) => s.unlockWithPin);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  const submit = async () => {
    if (pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlockWithPin(vaultPath, pin);
      await onUnlocked();
    } catch (err) {
      setPin('');
      setBusy(false);
      const status = await window.nexus.pin.status(vaultPath).catch(() => null);
      if (!status?.enabled) {
        onPinDisabled(message(err));
        return;
      }
      setError(message(err));
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="PIN" error={error ?? undefined}>
        <Input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          placeholder="4–8 digits"
          value={pin}
          onChange={(e) => {
            setPin(pinDigits(e.target.value));
            setError(null);
          }}
          disabled={busy}
          className="text-center font-code tracking-widest"
        />
      </Field>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        loading={busy}
        disabled={pin.length < 4}
      >
        {busy ? 'Unlocking…' : 'Unlock'}
      </Button>

      <Button variant="ghost" size="sm" onClick={onUseAnotherMethod} disabled={busy}>
        Use another method
      </Button>
    </form>
  );
}

export default PinUnlockForm;
