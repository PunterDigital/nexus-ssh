import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useUIStore } from '../../stores';
import { Button, Dialog, Field, Input } from '../ui';
import { pinDigits } from './PinUnlockForm';

// ============================================================
// PIN unlock settings (#2653): Settings → General → Security. The PIN is kept in memory by main
// until Nexus quits, so it only ever applies to the open vault in this session.
// ============================================================

const PIN_PATTERN = /^\d{4,8}$/;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The buttons in the "PIN unlock" settings row, and the dialog they open. */
export function PinUnlockControls(): React.ReactElement {
  const addNotification = useUIStore((s) => s.addNotification);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const vaultPath = await window.nexus.vault.current();
      setEnabled(vaultPath ? (await window.nexus.pin.status(vaultPath)).enabled : false);
    } catch {
      setEnabled(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const turnOff = async () => {
    try {
      await window.nexus.pin.clear();
      addNotification('success', 'PIN unlock is off');
    } catch (err) {
      addNotification('error', message(err));
    }
    await refresh();
  };

  if (enabled === null) return <span className="text-body-sm text-fg-muted">Checking…</span>;

  return (
    <>
      {enabled ? (
        <>
          <Button size="sm" variant="ghost" onClick={() => void turnOff()}>
            Turn Off
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            Change PIN…
          </Button>
        </>
      ) : (
        <Button size="sm" icon={KeyRound} onClick={() => setDialogOpen(true)}>
          Set Up PIN…
        </Button>
      )}
      {dialogOpen && (
        <PinSetupDialog
          changing={enabled}
          onClose={() => setDialogOpen(false)}
          onSaved={() => {
            setDialogOpen(false);
            addNotification('success', enabled ? 'PIN changed' : 'PIN unlock is on');
            void refresh();
          }}
        />
      )}
    </>
  );
}

interface PinSetupDialogProps {
  /** A PIN is already set: this changes it. */
  changing: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function PinSetupDialog({ changing, onClose, onSaved }: PinSetupDialogProps): React.ReactElement {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setPinError(null);
    setConfirmError(null);
    if (!PIN_PATTERN.test(pin)) {
      setPinError('Use 4 to 8 digits');
      return;
    }
    if (confirm !== pin) {
      setConfirmError("The PINs don't match");
      return;
    }
    setSaving(true);
    try {
      await window.nexus.pin.setup(pin);
      onSaved();
    } catch (err) {
      setPinError(message(err));
      setSaving(false);
    }
  };

  const pinInput = (value: string, set: (v: string) => void, placeholder: string) => (
    <Input
      type="password"
      inputMode="numeric"
      autoComplete="off"
      maxLength={8}
      placeholder={placeholder}
      value={value}
      disabled={saving}
      onChange={(e) => set(pinDigits(e.target.value))}
      className="font-code tracking-widest"
    />
  );

  return (
    <Dialog
      open
      onClose={() => !saving && onClose()}
      size="sm"
      title={changing ? 'Change PIN' : 'Set Up PIN Unlock'}
      description="Unlock this vault with a PIN until Nexus quits. After a restart you need your master password or hardware key once, and after 5 wrong PINs PIN unlock turns off."
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            {changing ? 'Change PIN' : 'Turn On'}
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
        // Two fields and no submit button inside the form: Enter in either one saves
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <Field label={changing ? 'New PIN' : 'PIN'} hint="4 to 8 digits" error={pinError ?? undefined}>
          {pinInput(pin, setPin, '4–8 digits')}
        </Field>
        <Field label="Confirm PIN" error={confirmError ?? undefined}>
          {pinInput(confirm, setConfirm, 'Type it again')}
        </Field>
      </form>
    </Dialog>
  );
}

export default PinSetupDialog;
