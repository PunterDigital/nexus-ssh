import React, { useMemo, useState } from 'react';
import { Code, Copy, Ellipsis, Pencil, Play, Plus, Search, SearchX, Trash2 } from 'lucide-react';
import type { Snippet } from '../../../shared/types';
import { useVaultStore } from '../../stores/vault-store';
import { useUIStore } from '../../stores/ui-store';
import { Icon } from '../common/Icon';
import { Button, Dialog, EmptyState, IconButton, Input, Menu, cx, type MenuEntry } from '../ui';
import { SnippetForm } from './SnippetForm';
import { SnippetExecuteDialog } from './SnippetExecuteDialog';
import { commandLines } from './variables';

// ============================================================
// SnippetsPanel — the vault's saved commands (design system: #2367 part 2).
//
// Header with the count, search and New Snippet; then one row per snippet. The row runs the
// snippet (SnippetExecuteDialog: command, target terminal, variables), the pencil edits it and
// "More actions" holds run, edit, copy command and delete. Deleting asks first in a Dialog named
// after the snippet. Fits a 560 px main area: the header wraps and long names / commands
// truncate with a tooltip.
// ============================================================

function matches(snippet: Snippet, query: string): boolean {
  const q = query.toLowerCase();
  return (
    snippet.name.toLowerCase().includes(q) ||
    (snippet.description ?? '').toLowerCase().includes(q) ||
    snippet.command.toLowerCase().includes(q)
  );
}

export const SnippetsPanel: React.FC = () => {
  const snippets = useVaultStore((s) => s.snippets);
  const deleteSnippet = useVaultStore((s) => s.deleteSnippet);
  const addNotification = useUIStore((s) => s.addNotification);

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [running, setRunning] = useState<Snippet | null>(null);
  const [toDelete, setToDelete] = useState<Snippet | null>(null);
  const [deleting, setDeleting] = useState(false);

  const query = search.trim();
  const visible = useMemo(
    () => (query ? snippets.filter((s) => matches(s, query)) : snippets),
    [snippets, query],
  );

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (snippet: Snippet) => {
    setEditing(snippet);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  const copyCommand = async (snippet: Snippet) => {
    try {
      await navigator.clipboard.writeText(snippet.command);
      addNotification('success', `Command of "${snippet.name}" copied to clipboard`);
    } catch {
      addNotification('error', 'Failed to copy the command to the clipboard');
    }
  };

  const handleDelete = async (snippet: Snippet) => {
    setDeleting(true);
    try {
      await deleteSnippet(snippet.id);
      addNotification('success', `Snippet "${snippet.name}" deleted`);
      setToDelete(null);
    } catch (err) {
      addNotification('error', `Failed to delete snippet: ${(err as Error).message}`);
    } finally {
      setDeleting(false);
    }
  };

  const snippetActions = (snippet: Snippet): MenuEntry[] => [
    { id: 'run', label: 'Run snippet…', icon: Play, onSelect: () => setRunning(snippet) },
    { id: 'edit', label: 'Edit snippet…', icon: Pencil, onSelect: () => openEdit(snippet) },
    { id: 'copy', label: 'Copy command', icon: Copy, onSelect: () => void copyCommand(snippet) },
    { separator: true, id: 'sep' },
    { id: 'delete', label: 'Delete snippet…', icon: Trash2, danger: true, onSelect: () => setToDelete(snippet) },
  ];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      {/* Header: wraps onto a second row in narrow windows instead of squashing */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <div className="mr-auto flex min-w-0 flex-col">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="truncate text-heading-sm font-semibold text-fg">Snippets</h2>
            <span className="shrink-0 text-body-sm text-fg-muted">
              {snippets.length} snippet{snippets.length !== 1 ? 's' : ''}
            </span>
          </div>
          <p className="truncate text-body-sm text-fg-muted">Saved commands you can run in the active terminal.</p>
        </div>
        <div className="flex min-w-0 shrink items-center gap-2">
          {snippets.length > 0 && (
            <div className="w-56 min-w-0 shrink">
              <Input
                leadingIcon={Search}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && search) {
                    e.preventDefault();
                    setSearch('');
                  }
                }}
                placeholder="Search snippets..."
                aria-label="Search snippets"
              />
            </div>
          )}
          <Button variant="primary" icon={Plus} onClick={openNew}>
            New Snippet
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
        {snippets.length === 0 ? (
          <EmptyState
            icon={Code}
            title="No snippets yet"
            description={
              <>
                Save a command you run often with <span className="font-medium text-fg-secondary">New Snippet</span>,
                then run it in any terminal session.
              </>
            }
            className="h-full"
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title={`No snippets match “${query}”`}
            description="Search looks at names, descriptions and commands."
            action={<Button onClick={() => setSearch('')}>Clear search</Button>}
            className="h-full"
          />
        ) : (
          <ul aria-label="Snippets" className="mx-auto flex w-full max-w-5xl flex-col gap-2">
            {visible.map((snippet) => (
              <SnippetRow
                key={snippet.id}
                snippet={snippet}
                actions={snippetActions(snippet)}
                onRun={() => setRunning(snippet)}
                onEdit={() => openEdit(snippet)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Dialogs */}
      <SnippetForm open={formOpen} onClose={closeForm} snippet={editing} />
      <SnippetExecuteDialog snippet={running} onClose={() => setRunning(null)} />

      <Dialog
        open={toDelete !== null}
        onClose={() => {
          if (!deleting) setToDelete(null);
        }}
        size="sm"
        title={toDelete ? `Delete ${toDelete.name}?` : 'Delete snippet?'}
        description="This permanently removes the snippet from the vault."
        footer={
          <>
            <Button variant="ghost" onClick={() => setToDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              loading={deleting}
              onClick={() => toDelete && void handleDelete(toDelete)}
            >
              Delete Snippet
            </Button>
          </>
        }
      />
    </div>
  );
};

// ── Snippet row ─────────────────────────────────────────────

interface SnippetRowProps {
  snippet: Snippet;
  actions: MenuEntry[];
  onRun: () => void;
  onEdit: () => void;
}

function SnippetRow({ snippet, actions, onRun, onEdit }: SnippetRowProps): React.ReactElement {
  const lines = commandLines(snippet.command);
  const more = lines.length - 1;
  return (
    <li
      className={cx(
        'group relative min-w-0 rounded-lg border border-line bg-surface-raised shadow-raised',
        'transition-colors duration-(--duration-fast) ease-standard hover:border-line-strong focus-within:border-line-strong',
      )}
    >
      {/* The row itself runs the snippet (after the Run dialog); the actions sit on its right edge. */}
      <button
        type="button"
        onClick={onRun}
        title={`Run ${snippet.name}`}
        className="flex w-full min-w-0 items-start gap-3 rounded-lg p-3 pr-20 text-left transition-colors duration-(--duration-fast) hover:bg-surface-hover focus-ring"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
          <Icon icon={Code} size={16} />
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-body font-semibold text-fg" title={snippet.name}>
              {snippet.name}
            </span>
            {snippet.run_on_connect && (
              <span className="shrink-0 rounded-sm bg-accent-soft px-1.5 text-caption font-medium text-accent">
                Auto-run
              </span>
            )}
          </span>
          {snippet.description && (
            <span className="truncate text-body-sm text-fg-secondary" title={snippet.description}>
              {snippet.description}
            </span>
          )}
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate font-code text-body-sm text-fg-muted" title={snippet.command}>
              {lines[0]}
            </span>
            {more > 0 && (
              <span className="shrink-0 text-caption text-fg-muted">
                +{more} line{more !== 1 ? 's' : ''}
              </span>
            )}
          </span>
        </span>
      </button>

      <div className="absolute top-3 right-3 flex items-center gap-1">
        <IconButton icon={Pencil} size="sm" label={`Edit ${snippet.name}`} onClick={onEdit} />
        <Menu
          align="end"
          label={`Actions for ${snippet.name}`}
          items={actions}
          trigger={(p) => <IconButton {...p} icon={Ellipsis} size="sm" label={`More actions for ${snippet.name}`} />}
        />
      </div>
    </li>
  );
}
