import React, { createContext, useContext, useId } from 'react';
import { cx } from './cx';

interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Inside a <Field>, Input/Select pick up its id, aria-describedby, aria-invalid and required. */
export function useField(): FieldContextValue | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  label: string;
  /** Short help under the control. Hidden while there is an error. */
  hint?: React.ReactNode;
  /** Error message: marks the control aria-invalid and is announced with it. */
  error?: React.ReactNode;
  required?: boolean;
  /** Content on the right of the label row (e.g. "Inherited from Production"). */
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** Label + control + hint/error, wired for screen readers. Wrap every form control in one. */
export function Field({ label, hint, error, required = false, aside, className, children }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;
  return (
    <FieldContext.Provider
      value={{ id, describedBy: message ? messageId : undefined, invalid: Boolean(error), required }}
    >
      <div className={cx('flex flex-col gap-1.5', className)}>
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={id} className="text-body-sm font-medium text-fg-secondary">
            {label}
            {required && (
              <span aria-hidden="true" className="ml-0.5 text-danger">
                *
              </span>
            )}
          </label>
          {aside && <div className="text-caption text-fg-muted">{aside}</div>}
        </div>
        {children}
        {message && (
          <p id={messageId} className={cx('text-caption', error ? 'text-danger' : 'text-fg-muted')}>
            {message}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}
