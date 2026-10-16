import type React from 'react';
import { useId } from 'react';
import { cx } from './cx';

export interface RadioOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  /** Second line, shown by the `list` variant. */
  description?: React.ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<T extends string = string> {
  /** Accessible name of the group (a visible legend when `showLabel`). */
  label: string;
  showLabel?: boolean;
  value: T;
  onChange: (value: T) => void;
  options: RadioOption<T>[];
  /** `segmented`: a row of buttons for 2–4 short choices. `list`: stacked rows with descriptions. */
  variant?: 'segmented' | 'list';
  className?: string;
}

/**
 * Pick one of a few options that are all worth seeing (otherwise use Select). Native radios,
 * so arrow keys move the selection and the group is one tab stop.
 */
export function RadioGroup<T extends string = string>({
  label,
  showLabel = false,
  value,
  onChange,
  options,
  variant = 'segmented',
  className,
}: RadioGroupProps<T>) {
  const name = useId();
  const labelId = `${name}-label`;
  const segmented = variant === 'segmented';
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      className={cx('flex flex-col gap-1.5', className)}
    >
      <span id={labelId} className={showLabel ? 'text-body-sm font-medium text-fg-secondary' : 'sr-only'}>
        {label}
      </span>
      <div
        className={
          segmented
            ? 'inline-flex w-fit flex-wrap gap-0.5 rounded-md border border-line-strong bg-surface-raised p-0.5'
            : 'flex flex-col gap-1'
        }
      >
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <label
              key={o.value}
              className={cx(
                'relative flex select-none transition-colors duration-(--duration-fast) ease-standard',
                o.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                segmented
                  ? 'h-6 items-center rounded-sm px-2.5 text-body-sm font-medium has-focus-visible:outline-2 has-focus-visible:outline-focus'
                  : 'items-start gap-2.5 rounded-md border p-2.5 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus',
                segmented &&
                  (selected ? 'bg-accent text-on-accent' : 'text-fg-secondary hover:bg-surface-hover hover:text-fg'),
                !segmented && (selected ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-hover'),
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={selected}
                disabled={o.disabled}
                onChange={() => onChange(o.value)}
                className={segmented ? 'sr-only' : 'mt-0.5 size-4 shrink-0 accent-accent'}
              />
              {segmented ? (
                o.label
              ) : (
                <span className="flex flex-col">
                  <span className={cx('text-body font-medium', selected ? 'text-accent' : 'text-fg')}>{o.label}</span>
                  {o.description && <span className="text-body-sm text-fg-muted">{o.description}</span>}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
