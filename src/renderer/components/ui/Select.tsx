import type React from 'react';
import { ChevronDown } from 'lucide-react';
import { Icon } from '../common/Icon';
import { cx } from './cx';
import { useField } from './Field';
import { FIELD_BASE, FIELD_SIZE } from './Input';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  options: SelectOption[];
  size?: keyof typeof FIELD_SIZE;
  invalid?: boolean;
  ref?: React.Ref<HTMLSelectElement>;
}

/** A native <select> (keyboard and screen-reader support for free) styled like Input. */
export function Select({ options, size = 'md', invalid, className, id, ...rest }: SelectProps) {
  const field = useField();
  return (
    <div className="relative w-full">
      <select
        id={id ?? field?.id}
        aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
        aria-invalid={invalid ?? field?.invalid ?? undefined}
        required={rest.required ?? field?.required}
        className={cx(FIELD_BASE, FIELD_SIZE[size], 'appearance-none pr-8', className)}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon
        icon={ChevronDown}
        size={14}
        className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-fg-muted"
      />
    </div>
  );
}
