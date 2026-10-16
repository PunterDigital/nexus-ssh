import type React from 'react';
import { cx } from './cx';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Visible label, clickable. */
  label: React.ReactNode;
  /** Secondary line under the label. */
  description?: React.ReactNode;
  ref?: React.Ref<HTMLInputElement>;
}

/** A native checkbox (keyboard and screen-reader support for free) with its label. */
export function Checkbox({ label, description, className, disabled, ...rest }: CheckboxProps) {
  return (
    <label
      className={cx(
        'inline-flex items-start gap-2 text-body text-fg',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      <input
        type="checkbox"
        disabled={disabled}
        className="mt-0.5 size-4 shrink-0 rounded-sm accent-accent focus-ring"
        {...rest}
      />
      <span className="flex flex-col">
        <span>{label}</span>
        {description && <span className="text-body-sm text-fg-muted">{description}</span>}
      </span>
    </label>
  );
}
