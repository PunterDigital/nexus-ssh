import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, CircleAlert } from 'lucide-react';
import type { Snippet } from '../../../shared/types';
import { useVaultStore } from '../../stores/vault-store';
import { useUIStore } from '../../stores/ui-store';
import { Icon } from '../common/Icon';
import { Button, Checkbox, Dialog, Field, Input, Textarea } from '../ui';
import { commandParts, findVariables, type SnippetVariable } from './variables';

// ============================================================
// SnippetForm — create / edit a snippet (design system: #2367 part 2).
//
// A ui/Dialog form like HostForm: mounted only while open (so it starts from the snippet, or
// empty), validates on submit with the error under the field, and shows a save failure in a
// banner so the values can be fixed and saved again. Lists the command's variables and how
// each one is filled in.
// ============================================================

export interface SnippetFormProps {
  open: boolean;
  onClose: () => void;
  /** Edits this snippet; without it the form creates one. */
  snippet?: Snippet | null;
}

type Errors = { name?: string; command?: string };

const BUILTIN_SOURCE: Record<string, string> = {
  hostname: 'the session’s hostname',
  username: 'the session’s username',
  port: 'the session’s port',
};

function describeVariable(v: SnippetVariable): string {
  if (v.type === 'builtin' && v.known) return `Filled in with ${BUILTIN_SOURCE[v.label]}`;
  return `Asks for “${v.label}” when run`;
}

export function SnippetForm(props: SnippetFormProps): React.ReactElement | null {
  if (!props.open) return null;
  return <SnippetFormDialog {...props} />;
}

function SnippetFormDialog({ onClose, snippet }: SnippetFormProps): React.ReactElement {
  const addSnippet = useVaultStore((s) => s.addSnippet);
  const updateSnippet = useVaultStore((s) => s.updateSnippet);
  const selectedVaultId = useVaultStore((s) => s.selectedVaultId);
  const addNotification = useUIStore((s) => s.addNotification);

  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(snippet?.name ?? '');
  const [description, setDescription] = useState(snippet?.description ?? '');
  const [command, setCommand] = useState(snippet?.command ?? '');
  const [runOnConnect, setRunOnConnect] = useState(snippet?.run_on_connect ?? false);
  const [errors, setErrors] = useState<Errors>({});
  // Bumped on each failed submit: focuses the first invalid field once it has rendered.
  const [invalidSubmits, setInvalidSubmits] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const variables = useMemo(() => findVariables(command), [command]);

  useEffect(() => {
    if (invalidSubmits === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [invalidSubmits]);

  const validate = (): boolean => {
    const e: Errors = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!command.trim()) e.command = 'Command is required';
    setErrors(e);
    if (Object.keys(e).length === 0) return true;
    setInvalidSubmits((n) => n + 1);
    return false;
  };

  const handleSave = async () => {
    if (!validate()) return;
    const data = {
      name: name.trim(),
      description: description.trim() || null,
      command: command.trimEnd(),
      run_on_connect: runOnConnect,
    };
    const vaultId = snippet?.vault_id ?? selectedVaultId;
    if (!vaultId) {
      setSaveError('No vault is open. Unlock or create a vault first.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (snippet) {
        await updateSnippet(snippet.id, data);
        addNotification('success', `Snippet "${data.name}" updated`);
      } else {
        await addSnippet({ vault_id: vaultId, ...data });
        addNotification('success', `Snippet "${data.name}" created`);
      }
      onClose();
    } catch (err) {
      setSaveError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={snippet ? `Edit ${snippet.name}` : 'New Snippet'}
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={saving}>
            {snippet ? 'Save Changes' : 'Create Snippet'}
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
          void handleSave();
        }}
      >
        {saveError && (
          <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-body-sm text-danger">
            <Icon icon={CircleAlert} className="mt-0.5" />
            {saveError}
          </p>
        )}

        <Field label="Name" required error={errors.name}>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
            }}
            placeholder="e.g. Deploy to Production"
            autoFocus
          />
        </Field>

        <Field label="Description" hint="Optional: shown in the list and before the snippet runs.">
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this snippet do?"
          />
        </Field>

        <Field
          label="Command"
          required
          error={errors.command}
          hint={
            <>
              One command per line. Variables: <code className="font-code">{'{{hostname}}'}</code>,{' '}
              <code className="font-code">{'{{username}}'}</code>, <code className="font-code">{'{{port}}'}</code>, or{' '}
              <code className="font-code">{'{{custom:Label}}'}</code> to ask for a value.
            </>
          }
        >
          <Textarea
            code
            rows={5}
            value={command}
            onChange={(e) => {
              setCommand(e.target.value);
              if (errors.command) setErrors((prev) => ({ ...prev, command: undefined }));
            }}
            placeholder={'cd /var/www/{{custom:Site}}\n./deploy.sh'}
            spellCheck={false}
            autoCapitalize="off"
          />
        </Field>

        {variables.length > 0 && (
          <section aria-labelledby={`${formId}-vars`} className="flex min-w-0 flex-col gap-1.5">
            <h3 id={`${formId}-vars`} className="text-body-sm font-medium text-fg-secondary">
              Variables
            </h3>
            <pre className="max-h-32 overflow-auto rounded-md border border-line bg-surface-sunken p-2 font-code text-body-sm whitespace-pre-wrap break-all text-fg scrollbar-thin">
              {commandParts(command).map((part, i) =>
                part.variable ? (
                  <mark key={i} className="rounded-sm bg-accent-soft px-0.5 text-accent">
                    {part.text}
                  </mark>
                ) : (
                  <React.Fragment key={i}>{part.text}</React.Fragment>
                ),
              )}
            </pre>
            <ul aria-label="Variables in the command" className="flex flex-col gap-1">
              {variables.map((v) => (
                <li
                  key={v.raw}
                  className="flex min-w-0 items-center gap-2 rounded-md bg-surface-raised px-2 py-1 text-body-sm"
                >
                  <code className="min-w-0 shrink truncate font-code text-accent" title={v.raw}>
                    {v.raw}
                  </code>
                  <Icon icon={ArrowRight} size={12} className="text-fg-muted" />
                  <span className="min-w-0 truncate text-fg-secondary">{describeVariable(v)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Checkbox
          label="Run on connect"
          description="Run automatically when connecting to a host."
          checked={runOnConnect}
          onChange={(e) => setRunOnConnect(e.target.checked)}
        />
      </form>
    </Dialog>
  );
}
