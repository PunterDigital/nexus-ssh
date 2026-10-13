import React, { useState, useCallback, useEffect } from 'react';
import { Modal } from '../common/Modal';

// ============================================================
// ChmodDialog — permissions editor with octal + checkbox grid
// ============================================================

interface ChmodDialogProps {
  open: boolean;
  onClose: () => void;
  filename: string;
  currentMode: number;
  onApply: (mode: string) => void;
}

const PERM_LABELS = ['Read', 'Write', 'Execute'] as const;
const ROLE_LABELS = ['Owner', 'Group', 'Others'] as const;

// Bit positions: owner r=8, w=7, x=6, group r=5, w=4, x=3, others r=2, w=1, x=0
const BIT_MAP: number[][] = [
  [0o400, 0o200, 0o100], // Owner: r, w, x
  [0o040, 0o020, 0o010], // Group: r, w, x
  [0o004, 0o002, 0o001], // Others: r, w, x
];

function modeToString(mode: number): string {
  const chars = 'rwxrwxrwx';
  let result = '';
  for (let i = 8; i >= 0; i--) {
    result += (mode & (1 << i)) ? chars[8 - i] : '-';
  }
  return result;
}

function modeToOctal(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, '0');
}

function octalToMode(octal: string): number {
  const parsed = parseInt(octal, 8);
  return isNaN(parsed) ? 0 : parsed & 0o777;
}

export const ChmodDialog: React.FC<ChmodDialogProps> = ({
  open,
  onClose,
  filename,
  currentMode,
  onApply,
}) => {
  const [mode, setMode] = useState(currentMode & 0o777);
  const [octalInput, setOctalInput] = useState(modeToOctal(currentMode));

  useEffect(() => {
    const m = currentMode & 0o777;
    setMode(m);
    setOctalInput(modeToOctal(m));
  }, [currentMode, open]);

  const toggleBit = useCallback((bit: number) => {
    setMode((prev) => {
      const next = prev ^ bit;
      setOctalInput(modeToOctal(next));
      return next;
    });
  }, []);

  const handleOctalChange = useCallback((value: string) => {
    // Only allow valid octal digits
    const cleaned = value.replace(/[^0-7]/g, '').slice(0, 3);
    setOctalInput(cleaned);
    if (cleaned.length === 3) {
      setMode(octalToMode(cleaned));
    }
  }, []);

  const handleApply = useCallback(() => {
    onApply(modeToOctal(mode));
    onClose();
  }, [mode, onApply, onClose]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Permissions: ${filename}`}
      maxWidth="max-w-md"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleApply}>
            Apply
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Octal input */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Octal:
          </label>
          <input
            className="input w-20 text-center font-mono text-sm"
            value={octalInput}
            onChange={(e) => handleOctalChange(e.target.value)}
            maxLength={3}
            spellCheck={false}
          />
          <span
            className="font-mono text-sm px-2 py-1 rounded"
            style={{
              backgroundColor: 'var(--color-bg-tertiary)',
              color: 'var(--color-text-primary)',
            }}
          >
            {modeToString(mode)}
          </span>
        </div>

        {/* Checkbox grid */}
        <div className="border rounded" style={{ borderColor: 'var(--color-border)' }}>
          {/* Header row */}
          <div
            className="grid grid-cols-4 gap-0 text-xs font-medium border-b"
            style={{
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-muted)',
            }}
          >
            <div className="px-3 py-2" />
            {PERM_LABELS.map((label) => (
              <div key={label} className="px-3 py-2 text-center">
                {label}
              </div>
            ))}
          </div>

          {/* Permission rows */}
          {ROLE_LABELS.map((role, ri) => (
            <div
              key={role}
              className="grid grid-cols-4 gap-0 text-xs border-b last:border-b-0"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div
                className="px-3 py-2 font-medium"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {role}
              </div>
              {PERM_LABELS.map((_, pi) => {
                const bit = BIT_MAP[ri][pi];
                const checked = (mode & bit) !== 0;
                return (
                  <div key={pi} className="px-3 py-2 flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleBit(bit)}
                      className="w-3.5 h-3.5 rounded cursor-pointer accent-[var(--color-accent)]"
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
};
