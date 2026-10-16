import type React from 'react';
import { cx } from './cx';
import { useField } from './Field';

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name when the switch is not inside a <Field> or labelled by a visible label. */
  label?: string;
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * An on/off setting that applies immediately (APG switch: a button with role="switch").
 * Inside a <Field> the field's label names it. Use Checkbox for choices that are saved with a form.
 */
export function Switch({ checked, onChange, label, id, className, disabled, ...rest }: SwitchProps) {
  const field = useField();
  return (
    <button
      type="button"
      role="switch"
      id={id ?? field?.id}
      aria-checked={checked}
      aria-label={label}
      aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
        'duration-(--duration-fast) ease-standard focus-ring disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface-raised',
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cx(
          'size-3.5 rounded-full shadow-raised transition-transform duration-(--duration-fast) ease-standard',
          checked ? 'translate-x-4.5 bg-on-accent' : 'translate-x-0.5 bg-fg-muted',
        )}
      />
    </button>
  );
}
