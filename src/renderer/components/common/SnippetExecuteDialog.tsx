import React, { useState, useMemo, useCallback } from 'react';
import type { Snippet } from '../../../shared/types';
import { Modal } from './Modal';
import { FormField } from './FormField';

// ============================================================
// SnippetExecuteDialog — Dialog for resolving custom variables
// before executing a snippet in the active terminal
// ============================================================

export interface SnippetExecuteDialogProps {
  open: boolean;
  onClose: () => void;
  onExecute: (resolvedCommand: string) => void;
  snippet: Snippet | null;
  /** Current session context for auto-filling builtins */
  sessionContext?: {
    hostname?: string;
    username?: string;
    port?: number;
  };
}

interface VariableEntry {
  raw: string;
  key: string;
  type: 'builtin' | 'custom';
  label: string;
  defaultValue: string;
}

function extractVariables(
  command: string,
  context?: SnippetExecuteDialogProps['sessionContext'],
): VariableEntry[] {
  const regex = /\{\{(\w+(?::[\w\s]+)?)\}\}/g;
  const seen = new Set<string>();
  const results: VariableEntry[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(command)) !== null) {
    const raw = match[0];
    if (seen.has(raw)) continue;
    seen.add(raw);

    const inner = match[1];
    if (inner.startsWith('custom:')) {
      const label = inner.slice(7);
      results.push({ raw, key: inner, type: 'custom', label, defaultValue: '' });
    } else {
      const builtinDefaults: Record<string, string> = {
        hostname: context?.hostname ?? '',
        username: context?.username ?? '',
        port: context?.port?.toString() ?? '22',
      };
      results.push({
        raw,
        key: inner,
        type: 'builtin',
        label: inner.charAt(0).toUpperCase() + inner.slice(1),
        defaultValue: builtinDefaults[inner] ?? '',
      });
    }
  }
  return results;
}

function resolveCommand(
  command: string,
  variables: VariableEntry[],
  values: Record<string, string>,
): string {
  let resolved = command;
  for (const v of variables) {
    const value = values[v.raw] ?? v.defaultValue;
    resolved = resolved.split(v.raw).join(value);
  }
  return resolved;
}

export const SnippetExecuteDialog: React.FC<SnippetExecuteDialogProps> = ({
  open,
  onClose,
  onExecute,
  snippet,
  sessionContext,
}) => {
  const variables = useMemo(
    () => (snippet ? extractVariables(snippet.command, sessionContext) : []),
    [snippet, sessionContext],
  );

  const [values, setValues] = useState<Record<string, string>>({});

  // Initialize default values when dialog opens
  React.useEffect(() => {
    if (open && variables.length > 0) {
      const defaults: Record<string, string> = {};
      for (const v of variables) {
        defaults[v.raw] = v.defaultValue;
      }
      setValues(defaults);
    }
  }, [open, variables]);

  const hasCustomVars = variables.some((v) => v.type === 'custom');

  const resolvedCommand = useMemo(() => {
    if (!snippet) return '';
    return resolveCommand(snippet.command, variables, values);
  }, [snippet, variables, values]);

  const handleValueChange = useCallback((raw: string, value: string) => {
    setValues((prev) => ({ ...prev, [raw]: value }));
  }, []);

  const handleExecute = useCallback(() => {
    onExecute(resolvedCommand);
  }, [onExecute, resolvedCommand]);

  if (!snippet) return null;

  // If no variables at all, just execute directly (caller should handle this)
  // But if opened, show the dialog for confirmation
  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
      <button className="btn btn-primary" onClick={handleExecute}>
        Execute
      </button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Execute: ${snippet.name}`}
      footer={footer}
      maxWidth="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        {/* Variable inputs */}
        {variables.length > 0 && (
          <div className="flex flex-col gap-3">
            {variables.map((v) => (
              <FormField
                key={v.raw}
                label={v.type === 'custom' ? v.label : v.label}
                helperText={
                  v.type === 'builtin'
                    ? `Auto-filled from active session`
                    : undefined
                }
              >
                <input
                  className="input font-mono text-xs"
                  type="text"
                  placeholder={v.type === 'custom' ? `Enter ${v.label}` : v.label}
                  value={values[v.raw] ?? v.defaultValue}
                  onChange={(e) => handleValueChange(v.raw, e.target.value)}
                  autoFocus={v.type === 'custom' && variables.indexOf(v) === variables.findIndex((x) => x.type === 'custom')}
                />
              </FormField>
            ))}
          </div>
        )}

        {!hasCustomVars && variables.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            This snippet has no variables. It will execute as-is.
          </p>
        )}

        {/* Resolved command preview */}
        <div className="flex flex-col gap-1">
          <span
            className="text-[10px] font-medium uppercase tracking-wider"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Resolved Command
          </span>
          <pre
            className="text-xs font-mono p-2.5 rounded overflow-x-auto whitespace-pre-wrap"
            style={{
              backgroundColor: 'var(--color-bg-secondary)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
              fontFamily: 'JetBrains Mono, Fira Code, Cascadia Code, Consolas, monospace',
              maxHeight: '200px',
            }}
          >
            {resolvedCommand}
          </pre>
        </div>
      </div>
    </Modal>
  );
};
