import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Play, SquareTerminal, TriangleAlert } from 'lucide-react';
import type { Snippet } from '../../../shared/types';
import { useTerminalStore } from '../../stores/terminal-store';
import { useUIStore } from '../../stores/ui-store';
import { Icon } from '../common/Icon';
import { Button, Dialog, Field, Input } from '../ui';
import { useSnippetTarget } from './useSnippetTarget';
import { commandLines, defaultValue, findVariables, resolveCommand } from './variables';

// ============================================================
// SnippetExecuteDialog — "Run <snippet>?" (design system: #2367 part 2).
//
// Shows the command and the terminal it will be typed into, asks for the snippet's variables
// ({{custom:…}} and any built-in the session can't fill), and previews the command with the
// values filled in. Every variable needs a value: a blank one could turn the command into
// something else. Runs in the active tab only if it is a connected terminal. Mounted only while
// a snippet is set, so it always starts from the session's values.
// ============================================================

export interface SnippetExecuteDialogProps {
  /** The snippet to run; null closes the dialog. */
  snippet: Snippet | null;
  onClose: () => void;
}

export function SnippetExecuteDialog({ snippet, onClose }: SnippetExecuteDialogProps): React.ReactElement | null {
  if (!snippet) return null;
  return <RunSnippetForm key={snippet.id} snippet={snippet} onClose={onClose} />;
}

function RunSnippetForm({ snippet, onClose }: { snippet: Snippet; onClose: () => void }): React.ReactElement {
  const writeToSession = useTerminalStore((s) => s.writeToSession);
  const addNotification = useUIStore((s) => s.addNotification);
  const target = useSnippetTarget();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  const variables = useMemo(() => findVariables(snippet.command), [snippet.command]);
  // What the user typed, by placeholder. Untouched built-ins follow the target session.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [invalidSubmits, setInvalidSubmits] = useState(0);

  const values = useMemo(() => {
    const out: Record<string, string> = {};
    for (const v of variables) out[v.raw] = typed[v.raw] ?? defaultValue(v, target?.context);
    return out;
  }, [variables, typed, target]);

  const resolved = useMemo(() => resolveCommand(snippet.command, values), [snippet.command, values]);

  useEffect(() => {
    if (invalidSubmits === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [invalidSubmits]);

  const setValue = (raw: string, value: string) => {
    setTyped((prev) => ({ ...prev, [raw]: value }));
    if (errors[raw]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[raw];
        return next;
      });
    }
  };

  const run = () => {
    const missing: Record<string, string> = {};
    for (const v of variables) {
      if (!values[v.raw].trim()) missing[v.raw] = `Enter a value for ${v.label}`;
    }
    setErrors(missing);
    if (Object.keys(missing).length > 0) {
      setInvalidSubmits((n) => n + 1);
      return;
    }
    if (!target) return;
    for (const line of commandLines(resolved)) writeToSession(target.sessionId, `${line}\n`);
    addNotification('success', `Ran "${snippet.name}" in ${target.label}`);
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Run "${snippet.name}"?`}
      description={snippet.description || undefined}
      dismissOnBackdrop={variables.length === 0}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" icon={Play} disabled={!target}>
            Run in Session
          </Button>
        </>
      }
    >
      <form
        id={formId}
        ref={formRef}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        {variables.length > 0 && (
          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="mb-3 text-body-sm font-medium text-fg-secondary">Variables</legend>
            {variables.map((v) => (
              <Field
                key={v.raw}
                label={v.label}
                required
                error={errors[v.raw]}
                hint={
                  v.type === 'builtin' && v.known
                    ? target
                      ? `From ${target.label}`
                      : 'Filled in from the session it runs in'
                    : undefined
                }
              >
                <Input
                  code
                  value={values[v.raw]}
                  onChange={(e) => setValue(v.raw, e.target.value)}
                  placeholder={v.type === 'custom' ? `Enter ${v.label}` : v.label}
                  spellCheck={false}
                  autoCapitalize="off"
                />
              </Field>
            ))}
          </fieldset>
        )}

        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-body-sm font-medium text-fg-secondary">
            {variables.length > 0 ? 'Command to run' : 'Command'}
          </span>
          <pre
            className="max-h-48 overflow-auto rounded-md border border-line bg-surface-sunken p-3 font-code text-body-sm whitespace-pre-wrap break-all text-fg scrollbar-thin"
          >
            {resolved}
          </pre>
        </div>

        {target ? (
          <p className="flex min-w-0 items-center gap-2 rounded-md border border-line bg-surface-sunken px-3 py-2 text-body-sm text-fg-secondary">
            <Icon icon={SquareTerminal} className="text-fg-muted" />
            <span className="min-w-0 truncate">
              Runs in <span className="font-semibold text-fg">{target.label}</span>{' '}
              <span className="font-code text-fg-muted">
                ({target.context.username ? `${target.context.username}@` : ''}
                {target.hostname})
              </span>
            </span>
          </p>
        ) : (
          <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-body-sm text-fg">
            <Icon icon={TriangleAlert} className="mt-0.5 text-warning" />
            No connected terminal is active. Connect to a host (or switch to its terminal tab), then run the
            snippet.
          </p>
        )}
      </form>
    </Dialog>
  );
}
