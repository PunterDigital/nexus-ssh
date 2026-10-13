import React from 'react';

// ============================================================
// FormField — Reusable form field wrapper with label, error,
// helper text, and inherited-value indicator
// ============================================================

export interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  helperText?: string;
  /** If set, shows a dimmed "Inherited from [groupName]" indicator */
  inheritedFrom?: string;
  children: React.ReactNode;
  className?: string;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  required,
  error,
  helperText,
  inheritedFrom,
  children,
  className = '',
}) => {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {/* Label row */}
      <div className="flex items-center gap-1.5">
        <label
          className="text-xs font-medium"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {label}
          {required && (
            <span className="ml-0.5" style={{ color: 'var(--color-danger)' }}>
              *
            </span>
          )}
        </label>

        {inheritedFrom && (
          <span
            className="text-[10px] italic px-1.5 py-0.5 rounded"
            style={{
              color: 'var(--color-text-muted)',
              backgroundColor: 'var(--color-bg-tertiary)',
            }}
            title={`Inherited from ${inheritedFrom}`}
          >
            Inherited from {inheritedFrom}
          </span>
        )}
      </div>

      {/* Input slot */}
      {children}

      {/* Error */}
      {error && (
        <span className="text-[11px]" style={{ color: 'var(--color-danger)' }}>
          {error}
        </span>
      )}

      {/* Helper text */}
      {helperText && !error && (
        <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          {helperText}
        </span>
      )}
    </div>
  );
};
