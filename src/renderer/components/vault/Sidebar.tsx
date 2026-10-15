import React, { useState, useRef, useEffect } from 'react';
import { useUIStore, useVaultStore, useTerminalStore } from '../../stores';
import type { ViewType } from '../../stores';
import type { Snippet } from '../../../shared/types';
import { SyncStatusBadge } from './SyncStatusBadge';

// ============================================================
// Sidebar — nav + quick snippet dropdown
// ============================================================

export const Sidebar: React.FC = () => {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const setView = useUIStore((s) => s.setView);
  const currentView = useUIStore((s) => s.currentView);
  const addNotification = useUIStore((s) => s.addNotification);

  const snippets = useVaultStore((s) => s.snippets);
  const hosts = useVaultStore((s) => s.hosts);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const sessions = useTerminalStore((s) => s.sessions);
  const writeToSession = useTerminalStore((s) => s.writeToSession);

  const requestVaultSwitch = useUIStore((s) => s.requestVaultSwitch);

  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);
  const [vaultName, setVaultName] = useState('');
  const vaultMenuRef = useRef<HTMLDivElement>(null);
  const [confirmSnippet, setConfirmSnippet] = useState<Snippet | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!snippetsOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSnippetsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [snippetsOpen]);

  // Name of the open vault (file name without .db) for the vault menu.
  useEffect(() => {
    let cancelled = false;
    window.nexus.vault
      .current()
      .then((p) => {
        if (!cancelled && p) setVaultName((p.split(/[/\\]/).pop() ?? '').replace(/\.db$/, ''));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!vaultMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (vaultMenuRef.current && !vaultMenuRef.current.contains(e.target as Node)) {
        setVaultMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [vaultMenuOpen]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeHost = activeSession ? hosts.find((h) => h.id === activeSession.hostId) : null;

  const handleSnippetClick = (snippet: Snippet) => {
    setSnippetsOpen(false);
    setConfirmSnippet(snippet);
  };

  const handleConfirmRun = () => {
    if (!confirmSnippet) return;
    if (!activeSessionId) {
      addNotification('warning', 'No active terminal session.');
      setConfirmSnippet(null);
      return;
    }
    const lines = confirmSnippet.command.split('\n');
    for (const line of lines) {
      writeToSession(activeSessionId, line + '\n');
    }
    addNotification('success', `Ran "${confirmSnippet.name}"`);
    setConfirmSnippet(null);
  };

  const navItems: { key: ViewType; label: string; icon: React.ReactNode }[] = [
    {
      key: 'connections',
      label: 'Hosts',
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1.5" y="2" width="11" height="4" rx="0.5" />
          <rect x="1.5" y="8" width="11" height="4" rx="0.5" />
          <circle cx="3.5" cy="4" r="0.5" fill="currentColor" />
          <circle cx="3.5" cy="10" r="0.5" fill="currentColor" />
        </svg>
      ),
    },
    {
      key: 'keychain',
      label: 'Keychain',
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="1" y="5" width="12" height="8" rx="1.5" />
          <path d="M4 5V3.5a3 3 0 0 1 6 0V5" />
          <circle cx="7" cy="9" r="1" />
        </svg>
      ),
    },
    {
      key: 'snippets',
      label: 'Snippets',
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <polyline points="4,4 1,7 4,10" />
          <polyline points="10,4 13,7 10,10" />
          <line x1="8.5" y1="2" x2="5.5" y2="12" />
        </svg>
      ),
    },
  ];

  // Collapsed sidebar
  if (sidebarCollapsed) {
    return (
      <div className="sidebar-transition no-select flex w-10 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <button
          onClick={toggleSidebar}
          className="flex h-10 items-center justify-center text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
          title="Expand sidebar"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polyline points="5,3 10,7 5,11" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="sidebar-transition no-select flex w-48 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      {/* Header: vault menu + collapse button */}
      <div className="flex h-8 items-center gap-1 px-2">
        <div ref={vaultMenuRef} className="relative min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setVaultMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={vaultMenuOpen}
            title="Vault menu"
            className="flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-[11px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="flex-shrink-0">
              <rect x="2" y="6" width="12" height="8" rx="1.5" />
              <path d="M5 6V4a3 3 0 0 1 6 0v2" />
            </svg>
            <span className="truncate">{vaultName || 'Vault'}</span>
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="flex-shrink-0 opacity-60">
              <polyline points="2,4 5,7 8,4" />
            </svg>
          </button>
          {vaultMenuOpen && (
            <div
              role="menu"
              className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setVaultMenuOpen(false);
                  requestVaultSwitch();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]"
              >
                Switch Vault…
              </button>
            </div>
          )}
        </div>
        <button
          onClick={toggleSidebar}
          className="rounded p-0.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
          title="Collapse sidebar"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polyline points="8,2 3,6 8,10" />
          </svg>
        </button>
      </div>

      {/* Navigation */}
      <div className="flex-1 px-2 py-1">
        {navItems.map((item) => {
          const active = currentView === item.key;
          return (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className={`mb-0.5 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                active
                  ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent)]'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}

        {/* Quick snippet dropdown */}
        <div ref={dropdownRef} className="relative mt-2 border-t border-[var(--color-border)] pt-2">
          <button
            type="button"
            onClick={() => setSnippetsOpen((v) => !v)}
            disabled={snippets.length === 0}
            className="flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex items-center gap-2.5">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <polygon points="3,2 3,12 11,7" fill="currentColor" stroke="none" />
              </svg>
              Run Snippet
            </span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              className={`transition-transform ${snippetsOpen ? 'rotate-180' : ''}`}
            >
              <polyline points="2,4 5,7 8,4" />
            </svg>
          </button>

          {/* Dropdown panel */}
          {snippetsOpen && snippets.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] shadow-lg scrollbar-hidden">
              {snippets.map((snippet) => (
                <button
                  key={snippet.id}
                  type="button"
                  onClick={() => handleSnippetClick(snippet)}
                  className="flex w-full flex-col items-start gap-0.5 border-b border-[var(--color-border)] px-3 py-2 text-left last:border-b-0 hover:bg-[var(--color-bg-tertiary)]"
                >
                  <span className="w-full truncate text-xs font-medium text-[var(--color-text-primary)]">
                    {snippet.name}
                  </span>
                  {snippet.description && (
                    <span className="w-full truncate text-[10px] text-[var(--color-text-muted)]">
                      {snippet.description}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Sync status */}
      <div className="border-t border-[var(--color-border)]">
        <SyncStatusBadge />
      </div>

      {/* Confirmation modal — rendered inline to avoid extra imports */}
      {confirmSnippet && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
        >
          <div
            className="w-[460px] max-w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-5 shadow-2xl"
          >
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
              Run &ldquo;{confirmSnippet.name}&rdquo;?
            </h3>
            {confirmSnippet.description && (
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                {confirmSnippet.description}
              </p>
            )}

            <div className="mt-3">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                Command
              </div>
              <pre
                className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2.5 text-[11px] font-mono text-[var(--color-text-primary)]"
              >
                {confirmSnippet.command}
              </pre>
            </div>

            <div className="mt-3 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[11px]">
              {activeSession && activeHost ? (
                <span className="text-[var(--color-text-secondary)]">
                  Will run in{' '}
                  <span className="font-semibold text-[var(--color-text-primary)]">
                    {activeHost.label}
                  </span>{' '}
                  <span className="text-[var(--color-text-muted)]">
                    ({activeHost.hostname})
                  </span>
                </span>
              ) : (
                <span className="text-[var(--color-danger)]">
                  No active terminal session. Connect to a host first.
                </span>
              )}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmSnippet(null)}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-tertiary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRun}
                disabled={!activeSessionId}
                className="rounded-md bg-[var(--color-accent)] px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
