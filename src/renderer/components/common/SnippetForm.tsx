import React, { useState, useMemo, useCallback } from 'react';
import type { Snippet } from '../../../shared/types';
import { Modal } from './Modal';
import { FormField } from './FormField';

// ============================================================
// SnippetForm — Modal form for creating/editing a snippet
// ============================================================

export interface SnippetFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: SnippetFormData) => void;
  /** If provided, the form is in edit mode */
  snippet?: Snippet | null;
}

export interface SnippetFormData {
  name: string;
  description: string;
  command: string;
  run_on_connect: boolean;
}

interface DetectedVariable {
  raw: string;
  type: 'builtin' | 'custom';
  label: string;
  sampleValue: string;
}

/** Extract {{variable}} and {{custom:label}} placeholders from a command string. */
function detectVariables(command: string): DetectedVariable[] {
  const regex = /\{\{(\w+(?::[\w\s]+)?)\}\}/g;
  const seen = new Set<string>();
  const results: DetectedVariable[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(command)) !== null) {
    const raw = match[0];
    if (seen.has(raw)) continue;
    seen.add(raw);

    const inner = match[1];
    if (inner.startsWith('custom:')) {
      const label = inner.slice(7);
      results.push({ raw, type: 'custom', label, sampleValue: `<${label}>` });
    } else {
      const builtinSamples: Record<string, string> = {
        hostname: 'example.com',
        username: 'deploy',
        port: '22',
      };
      results.push({
        raw,
        type: 'builtin',
        label: inner,
        sampleValue: builtinSamples[inner] ?? `<${inner}>`,
      });
    }
  }
  return results;
}

/** Render command text with highlighted variable placeholders. */
function highlightCommand(command: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\{\{\w+(?::[\w\s]+)?\}\})/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(command)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={key++}>{command.slice(lastIndex, match.index)}</span>,
      );
    }
    parts.push(
      <span
        key={key++}
        className="rounded px-0.5"
        style={{
          backgroundColor: 'var(--color-accent-muted)',
          color: 'var(--color-accent)',
        }}
      >
        {match[0]}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < command.length) {
    parts.push(<span key={key++}>{command.slice(lastIndex)}</span>);
  }
  return parts;
}

export const SnippetForm: React.FC<SnippetFormProps> = ({
  open,
  onClose,
  onSave,
  snippet,
}) => {
  const isEdit = !!snippet;

  const [name, setName] = useState(snippet?.name ?? '');
  const [description, setDescription] = useState(snippet?.description ?? '');
  const [command, setCommand] = useState(snippet?.command ?? '');
  const [runOnConnect, setRunOnConnect] = useState(snippet?.run_on_connect ?? false);

  const [errors, setErrors] = useState<{ name?: string; command?: string }>({});

  // Reset form when snippet changes
  React.useEffect(() => {
    setName(snippet?.name ?? '');
    setDescription(snippet?.description ?? '');
    setCommand(snippet?.command ?? '');
    setRunOnConnect(snippet?.run_on_connect ?? false);
    setErrors({});
  }, [snippet, open]);

  const detectedVars = useMemo(() => detectVariables(command), [command]);

  const validate = useCallback((): boolean => {
    const errs: { name?: string; command?: string } = {};
    if (!name.trim()) errs.name = 'Name is required';
    if (!command.trim()) errs.command = 'Command is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [name, command]);

  const handleSave = useCallback(() => {
    if (!validate()) return;
    onSave({
      name: name.trim(),
      description: description.trim(),
      command: command.trimEnd(),
      run_on_connect: runOnConnect,
    });
  }, [validate, onSave, name, description, command, runOnConnect]);

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
      <button type="button" className="btn btn-primary" onClick={handleSave}>
        {isEdit ? 'Save Changes' : 'Create Snippet'}
      </button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Snippet' : 'New Snippet'}
      footer={footer}
      maxWidth="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        {/* Name */}
        <FormField label="Name" required error={errors.name}>
          <input
            className="input"
            type="text"
            placeholder="e.g. Deploy to Production"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </FormField>

        {/* Description */}
        <FormField label="Description" helperText="Optional description for this snippet">
          <textarea
            className="input resize-none"
            rows={2}
            placeholder="What does this snippet do?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>

        {/* Command */}
        <FormField
          label="Command"
          required
          error={errors.command}
          helperText="Supports multi-line. Use {{hostname}}, {{username}}, {{port}}, or {{custom:label}} for variables."
        >
          <textarea
            className="input resize-none font-mono text-xs"
            rows={5}
            placeholder={'ssh {{username}}@{{hostname}} -p {{port}}\ncd /var/www\n./deploy.sh'}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            style={{
              backgroundColor: 'var(--color-bg-secondary)',
              fontFamily: 'JetBrains Mono, Fira Code, Cascadia Code, Consolas, monospace',
              lineHeight: '1.6',
            }}
          />
        </FormField>

        {/* Command preview with highlighted variables */}
        {command.trim() && (
          <div className="flex flex-col gap-1">
            <span
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Preview
            </span>
            <pre
              className="text-xs font-mono p-2.5 rounded overflow-x-auto whitespace-pre-wrap"
              style={{
                backgroundColor: 'var(--color-bg-secondary)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border)',
                fontFamily: 'JetBrains Mono, Fira Code, Cascadia Code, Consolas, monospace',
              }}
            >
              {highlightCommand(command)}
            </pre>
          </div>
        )}

        {/* Detected variables */}
        {detectedVars.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Detected Variables
            </span>
            <div className="flex flex-col gap-1">
              {detectedVars.map((v) => (
                <div
                  key={v.raw}
                  className="flex items-center gap-2 text-xs px-2 py-1 rounded"
                  style={{ backgroundColor: 'var(--color-bg-tertiary)' }}
                >
                  <code
                    className="font-mono text-[11px]"
                    style={{ color: 'var(--color-accent)' }}
                  >
                    {v.raw}
                  </code>
                  <span style={{ color: 'var(--color-text-muted)' }}>&rarr;</span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>
                    {v.type === 'custom'
                      ? `Prompts: "${v.label}"`
                      : v.sampleValue}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Run on connect toggle */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              Run on connect
            </span>
            <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
              Automatically execute when connecting to a host
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={runOnConnect}
            onClick={() => setRunOnConnect(!runOnConnect)}
            className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
            style={{
              backgroundColor: runOnConnect ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
            }}
          >
            <span
              className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
              style={{
                left: '2px',
                transform: runOnConnect ? 'translateX(16px)' : 'translateX(0)',
              }}
            />
          </button>
        </div>
      </div>
    </Modal>
  );
};
