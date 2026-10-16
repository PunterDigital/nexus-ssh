import type React from 'react';
import { cx } from './cx';
import { useField } from './Field';
import { FIELD_BASE } from './Input';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Monospace text, for commands and keys. */
  code?: boolean;
  invalid?: boolean;
  ref?: React.Ref<HTMLTextAreaElement>;
}

/** Multi-line text, styled like Input. Inside a <Field> it picks up the label, hint and error. */
export function Textarea({
  code = false,
  invalid,
  className,
  id,
  rows = 3,
  ...rest
}: TextareaProps) {
  const field = useField();
  return (
    <textarea
      id={id ?? field?.id}
      rows={rows}
      aria-describedby={rest['aria-describedby'] ?? field?.describedBy}
      aria-invalid={invalid ?? field?.invalid ?? undefined}
      required={rest.required ?? field?.required}
      className={cx(
        FIELD_BASE,
        'resize-y px-2.5 py-1.5 text-body',
        code && 'font-code',
        className
      )}
      {...rest}
    />
  );
}
