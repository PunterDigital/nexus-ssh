import React, { useEffect, useId, useState } from 'react';
import { Button, Checkbox, Dialog, Field, Input } from '../ui';

// ============================================================
// ChmodDialog — edit a remote file's permissions: an octal field and a Read / Write / Execute
// checkbox per class (owner, group, others), kept in sync. Special bits (setuid, setgid,
// sticky) aren't editable here but are kept, so applying never clears them.
// ============================================================

interface ChmodDialogProps {
  open: boolean;
  onClose: () => void;
  filename: string;
  /** The entry's full st_mode (type bits are ignored). */
  currentMode: number;
  /**
   * Applies the new mode, as octal digits (e.g. "644", or "4755" when special bits are set).
   * The dialog closes when it resolves and stays open when it rejects (the caller reports why).
   */
  onApply: (mode: string) => Promise<void> | void;
}

const PERMS = ['Read', 'Write', 'Execute'] as const;
const CLASSES = ['Owner', 'Group', 'Others'] as const;

// BITS[class][perm]: owner rwx = 0o400 0o200 0o100, group = 0o040 …, others = 0o004 …
const BITS: number[][] = [
  [0o400, 0o200, 0o100],
  [0o040, 0o020, 0o010],
  [0o004, 0o002, 0o001],
];

const SPECIAL_BITS = 0o7000;

export function modeToString(mode: number): string {
  const chars = 'rwxrwxrwx';
  let result = '';
  for (let i = 8; i >= 0; i--) result += mode & (1 << i) ? chars[8 - i] : '-';
  return result;
}

function toOctal(perms: number): string {
  return (perms & 0o777).toString(8).padStart(3, '0');
}

/** The mode string sent to the server: the edited rwx bits plus the file's special bits. */
export function chmodModeString(currentMode: number, perms: number): string {
  const special = currentMode & SPECIAL_BITS;
  const mode = special | (perms & 0o777);
  return special ? mode.toString(8).padStart(4, '0') : toOctal(mode);
}

export const ChmodDialog: React.FC<ChmodDialogProps> = ({
  open,
  onClose,
  filename,
  currentMode,
  onApply,
}) => {
  const id = useId();
  const [perms, setPerms] = useState(currentMode & 0o777);
  const [octal, setOctal] = useState(toOctal(currentMode));
  const [octalError, setOctalError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    setPerms(currentMode & 0o777);
    setOctal(toOctal(currentMode));
    setOctalError(null);
  }, [currentMode, open]);

  const toggleBit = (bit: number) => {
    const next = perms ^ bit;
    setPerms(next);
    setOctal(toOctal(next));
    setOctalError(null);
  };

  const handleOctalChange = (value: string) => {
    const cleaned = value.replace(/[^0-7]/g, '').slice(0, 3);
    setOctal(cleaned);
    setOctalError(null);
    if (cleaned.length === 3) setPerms(parseInt(cleaned, 8));
  };

  const handleApply = async () => {
    // A half-typed octal value used to be ignored silently (the old mode was applied).
    if (octal.length !== 3) {
      setOctalError('Enter three digits from 0 to 7, e.g. 644');
      return;
    }
    setApplying(true);
    try {
      await onApply(chmodModeString(currentMode, perms));
      onClose();
    } catch {
      // The caller has shown the error; leave the dialog open to try again.
    } finally {
      setApplying(false);
    }
  };

  const hasSpecialBits = (currentMode & SPECIAL_BITS) !== 0;

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!applying) onClose();
      }}
      size="sm"
      title={`Permissions for ${filename}`}
      description={
        hasSpecialBits ? 'Its special bits (setuid, setgid, sticky) are kept.' : undefined
      }
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={applying}>
            Cancel
          </Button>
          <Button variant="primary" loading={applying} onClick={() => void handleApply()}>
            Set Permissions
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void handleApply();
        }}
      >
        <Field label="Octal" error={octalError}>
          <div className="flex items-center gap-3">
            {/* Input is full width: the wrapper sizes it */}
            <div className="w-20 shrink-0">
              <Input
                code
                value={octal}
                onChange={(e) => handleOctalChange(e.target.value)}
                inputMode="numeric"
                maxLength={3}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <span
              title="Symbolic notation"
              className="rounded-sm bg-surface-raised px-2 py-0.5 font-code text-body text-fg"
            >
              {modeToString(perms)}
            </span>
          </div>
        </Field>

        <div className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {CLASSES.map((cls, ci) => (
            <div
              key={cls}
              role="group"
              aria-labelledby={`${id}-${cls}`}
              className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2.5"
            >
              <span
                id={`${id}-${cls}`}
                className="w-16 text-body-sm font-medium text-fg-secondary"
              >
                {cls}
              </span>
              {PERMS.map((perm, pi) => (
                <Checkbox
                  key={perm}
                  label={perm}
                  checked={(perms & BITS[ci][pi]) !== 0}
                  onChange={() => toggleBit(BITS[ci][pi])}
                />
              ))}
            </div>
          ))}
        </div>
        {/* Enter in the octal field submits the form (one text field: implicit submission). */}
      </form>
    </Dialog>
  );
};
