import React, { useState, useCallback } from 'react';
import type { Snippet } from '../../../shared/types';
import { useVaultStore } from '../../stores/vault-store';
import { useTerminalStore } from '../../stores/terminal-store';
import { useUIStore } from '../../stores/ui-store';
import { SnippetForm, type SnippetFormData } from './SnippetForm';
import { SnippetExecuteDialog } from './SnippetExecuteDialog';
import { Modal } from './Modal';

// ============================================================
// SnippetsPanel — compact list of snippets. Click to run.
// ============================================================

export const SnippetsPanel: React.FC = () => {
  const snippets = useVaultStore((s) => s.snippets);
  const addSnippet = useVaultStore((s) => s.addSnippet);
  const updateSnippet = useVaultStore((s) => s.updateSnippet);
  const deleteSnippet = useVaultStore((s) => s.deleteSnippet);
  const selectedVaultId = useVaultStore((s) => s.selectedVaultId);
  const addNotification = useUIStore((s) => s.addNotification);

  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const sessions = useTerminalStore((s) => s.sessions);
  const writeToSession = useTerminalStore((s) => s.writeToSession);
  const hosts = useVaultStore((s) => s.hosts);

  const [formOpen, setFormOpen] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
  const [confirmRunSnippet, setConfirmRunSnippet] = useState<Snippet | null>(null);
  const [executeSnippet, setExecuteSnippet] = useState<Snippet | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Active session context for variable resolution
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeHost = activeSession
    ? hosts.find((h) => h.id === activeSession.hostId)
    : null;

  const sessionContext = React.useMemo(() => {
    if (!activeHost) return undefined;
    return {
      hostname: activeHost.hostname,
      username: activeHost.username ?? undefined,
      port: activeHost.port,
    };
  }, [activeHost]);

  const handleNewSnippet = useCallback(() => {
    setEditingSnippet(null);
    setFormOpen(true);
  }, []);

  const handleEdit = useCallback((snippet: Snippet) => {
    setEditingSnippet(snippet);
    setFormOpen(true);
  }, []);

  const handleFormSave = useCallback(
    async (data: SnippetFormData) => {
      try {
        if (editingSnippet) {
          await updateSnippet(editingSnippet.id, {
            name: data.name,
            description: data.description || null,
            command: data.command,
            run_on_connect: data.run_on_connect,
          });
          addNotification('success', `Snippet "${data.name}" updated`);
        } else {
          if (!selectedVaultId) {
            addNotification('error', 'No vault selected');
            return;
          }
          await addSnippet({
            vault_id: selectedVaultId,
            name: data.name,
            description: data.description || null,
            command: data.command,
            run_on_connect: data.run_on_connect,
          });
          addNotification('success', `Snippet "${data.name}" created`);
        }
        setFormOpen(false);
        setEditingSnippet(null);
      } catch (err) {
        addNotification('error', (err as Error).message);
      }
    },
    [editingSnippet, addSnippet, updateSnippet, addNotification, selectedVaultId],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const snippet = snippets.find((s) => s.id === id);
        await deleteSnippet(id);
        addNotification('success', `Snippet "${snippet?.name}" deleted`);
        setConfirmDeleteId(null);
      } catch (err) {
        addNotification('error', (err as Error).message);
      }
    },
    [deleteSnippet, snippets, addNotification],
  );

  const handleRowClick = useCallback((snippet: Snippet) => {
    setConfirmRunSnippet(snippet);
  }, []);

  const executeCommand = useCallback(
    (command: string) => {
      if (!activeSessionId) {
        addNotification('warning', 'No active terminal session. Connect to a host first.');
        return;
      }
      const lines = command.split('\n');
      for (const line of lines) {
        writeToSession(activeSessionId, line + '\n');
      }
      addNotification('success', 'Snippet executed');
      setExecuteSnippet(null);
      setConfirmRunSnippet(null);
    },
    [activeSessionId, writeToSession, addNotification],
  );

  const handleConfirmRun = useCallback(() => {
    if (!confirmRunSnippet) return;
    const snippet = confirmRunSnippet;
    // If there are custom variables, hand off to the execute dialog
    const hasCustomVars = /\{\{custom:[\w\s]+\}\}/.test(snippet.command);
    if (hasCustomVars) {
      setExecuteSnippet(snippet);
      setConfirmRunSnippet(null);
    } else {
      executeCommand(snippet.command);
    }
  }, [confirmRunSnippet, executeCommand]);

  return (
    <div className="flex flex-1 flex-col h-full w-full bg-[var(--color-bg-primary)]">
      {/* Header */}
      <div className="flex w-full items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
        <div>
          <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">
            Snippets
          </h1>
          <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
            Reusable commands you can run in any active terminal
          </p>
        </div>
        <button
          onClick={handleNewSnippet}
          className="flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 active:scale-[0.97]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="6" y1="2" x2="6" y2="10" />
            <line x1="2" y1="6" x2="10" y2="6" />
          </svg>
          New Snippet
        </button>
      </div>

      {/* Snippet list */}
      <div className="flex-1 overflow-y-auto p-3">
        {snippets.length === 0 ? (
          <EmptyState onCreate={handleNewSnippet} />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-1">
            {snippets.map((snippet) => (
              <SnippetRow
                key={snippet.id}
                snippet={snippet}
                onRun={() => handleRowClick(snippet)}
                onEdit={() => handleEdit(snippet)}
                onDelete={() => setConfirmDeleteId(snippet.id)}
                deleting={confirmDeleteId === snippet.id}
                onConfirmDelete={() => handleDelete(snippet.id)}
                onCancelDelete={() => setConfirmDeleteId(null)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Snippet Form Modal */}
      <SnippetForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingSnippet(null);
        }}
        onSave={handleFormSave}
        snippet={editingSnippet}
      />

      {/* Run Confirmation Modal */}
      {confirmRunSnippet && (
        <Modal
          open={true}
          onClose={() => setConfirmRunSnippet(null)}
          title={`Run "${confirmRunSnippet.name}"`}
          maxWidth="max-w-lg"
        >
          <div className="flex flex-col gap-3">
            {confirmRunSnippet.description && (
              <p className="text-xs text-[var(--color-text-secondary)]">
                {confirmRunSnippet.description}
              </p>
            )}
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                Command
              </div>
              <pre
                className="overflow-x-auto whitespace-pre-wrap rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-[11px] font-mono text-[var(--color-text-primary)]"
                style={{ maxHeight: '200px', overflowY: 'auto' }}
              >
                {confirmRunSnippet.command}
              </pre>
            </div>
            <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[11px]">
              {activeSession && activeHost ? (
                <span className="text-[var(--color-text-secondary)]">
                  Will run in{' '}
                  <span className="font-semibold text-[var(--color-text-primary)]">
                    {activeHost.label}
                  </span>{' '}
                  <span className="text-[var(--color-text-muted)]">
                    ({activeHost.username ? `${activeHost.username}@` : ''}{activeHost.hostname})
                  </span>
                </span>
              ) : (
                <span className="text-[var(--color-danger)]">
                  No active terminal session. Connect to a host first.
                </span>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmRunSnippet(null)}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-tertiary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRun}
                disabled={!activeSessionId}
                className="flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                  <polygon points="1,0 1,10 9,5" />
                </svg>
                Run in Session
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Execute Dialog (for custom variable snippets) */}
      <SnippetExecuteDialog
        open={!!executeSnippet}
        onClose={() => setExecuteSnippet(null)}
        onExecute={executeCommand}
        snippet={executeSnippet}
        sessionContext={sessionContext}
      />
    </div>
  );
};

// ── Row component ──────────────────────────────────────────

interface SnippetRowProps {
  snippet: Snippet;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

const SnippetRow: React.FC<SnippetRowProps> = ({
  snippet,
  onRun,
  onEdit,
  onDelete,
  deleting,
  onConfirmDelete,
  onCancelDelete,
}) => {
  const firstLine = snippet.command.split('\n')[0];
  return (
    <div className="group flex items-center gap-3 rounded-md border border-transparent px-3 py-2 transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)]">
      {/* Click-to-run main area */}
      <button
        type="button"
        onClick={onRun}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] group-hover:bg-[var(--color-bg-tertiary)] group-hover:text-[var(--color-accent)]">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <polygon points="2,1 2,11 10,6" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-medium text-[var(--color-text-primary)]">
              {snippet.name}
            </span>
            {snippet.run_on_connect && (
              <span className="rounded-full bg-[var(--color-accent-muted)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--color-accent)]">
                auto-run
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--color-text-muted)]">
            {snippet.description || firstLine}
          </div>
        </div>
      </button>

      {/* Actions (revealed on hover) */}
      <div className="flex flex-shrink-0 items-center gap-1">
        {deleting ? (
          <>
            <button
              type="button"
              onClick={onConfirmDelete}
              className="rounded px-2 py-1 text-[10px] font-medium text-[var(--color-danger)] hover:bg-[rgba(247,118,142,0.15)]"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              className="rounded px-2 py-1 text-[10px] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onEdit}
              className="rounded p-1.5 text-[var(--color-text-muted)] opacity-0 transition-opacity hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] group-hover:opacity-100"
              title="Edit snippet"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2l2 2-6 6-2 1 1-2 5-7z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded p-1.5 text-[var(--color-text-muted)] opacity-0 transition-opacity hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-danger)] group-hover:opacity-100"
              title="Delete snippet"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M2 3h8" />
                <path d="M4 3V2h4v1" />
                <path d="M3 3v8h6V3" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// ── Empty state ────────────────────────────────────────────

const EmptyState: React.FC<{ onCreate: () => void }> = ({ onCreate }) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-bg-tertiary)]">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-text-muted)]">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    </div>
    <div>
      <p className="text-sm font-medium text-[var(--color-text-secondary)]">
        No snippets yet
      </p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        Save reusable commands to run them in any active terminal.
      </p>
    </div>
    <button
      type="button"
      onClick={onCreate}
      className="mt-1 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
    >
      Create your first snippet
    </button>
  </div>
);
