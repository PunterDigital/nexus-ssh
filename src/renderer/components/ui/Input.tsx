import type React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../common/Icon';
import { cx } from './cx';
import { useField } from './Field';

export const FIELD_BASE =
  'w-full rounded-md border border-line-strong bg-surface-raised text-fg placeholder:text-fg-muted ' +
  'transition-colors duration-(--duration-fast) ease-standard focus-ring focus-visible:border-focus ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger';

export const FIELD_SIZE = {
  sm: 'h-6 px-2 text-body-sm',
  md: 'h-8 px-2.5 text-body',
} as const;

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: keyof typeof FIELD_SIZE;
  /** Icon inside the field on the left (e.g. Search). */
  leadingIcon?: LucideIcon;
  /** Monospace text, for paths, hostnames and keys. */
  code?: boolean;
  invalid?: boolean;
  ref?: React.Ref<HTMLInputElement>;
}

export function Input({ size = 'md', leadingIcon, code = false, invalid, className, id, ...rest }: InputProps) {
  const field = useField();
  const input = (
    <input
      id={id ?? field?.id}
      aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
      aria-invalid={invalid ?? field?.invalid ?? undefined}
      required={rest.required ?? field?.required}
      className={cx(FIELD_BASE, FIELD_SIZE[size], code && 'font-code', leadingIcon && 'pl-8', className)}
      {...rest}
    />
  );
  if (!leadingIcon) return input;
  return (
    <div className="relative w-full">
      <Icon
        icon={leadingIcon}
        size={size === 'sm' ? 12 : 14}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-muted"
      />
      {input}
    </div>
  );
}
