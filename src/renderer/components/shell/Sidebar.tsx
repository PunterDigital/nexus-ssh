import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Code,
  FolderSync,
  KeyRound,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Server,
  type LucideIcon,
} from 'lucide-react';
import { useUIStore, useVaultStore, useTerminalStore } from '../../stores';
import type { ViewType } from '../../stores';
import type { Snippet } from '../../../shared/types';
import { Button, Dialog, IconButton, Menu, cx, type MenuEntry } from '../ui';
import { Icon } from '../common/Icon';
import { SyncStatusBadge } from '../vault/SyncStatusBadge';
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  effectiveSidebarWidth,
  sidebarWidthForKey,
} from './layout';
import { useWindowWidth } from './useWindowWidth';

// ============================================================
// Sidebar — vault menu, main navigation, snippet runner, sync status.
// Resizable (drag or arrow keys on the right edge) and collapsible to an icon rail (#2365).
// ============================================================

const NAV_ITEMS: { key: ViewType; label: string; icon: LucideIcon }[] = [
  { key: 'connections', label: 'Hosts', icon: Server },
  { key: 'sftp', label: 'SFTP', icon: FolderSync },
  { key: 'keychain', label: 'Keychain', icon: KeyRound },
  { key: 'snippets', label: 'Snippets', icon: Code },
];

/** Name of the open vault (file name without .db). */
function useVaultName(): string {
  const [name, setName] = useState('');
  useEffect(() => {
    let cancelled = false;
    window.nexus.vault
      .current()
      .then((p) => {
        if (!cancelled && p) setName((p.split(/[/\\]/).pop() ?? '').replace(/\.db$/, ''));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return name;
}

export const Sidebar: React.FC = () => {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const width = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const setView = useUIStore((s) => s.setView);
  const currentView = useUIStore((s) => s.currentView);
  const requestVaultSwitch = useUIStore((s) => s.requestVaultSwitch);
  const snippets = useVaultStore((s) => s.snippets);

  const vaultName = useVaultName();
  const windowWidth = useWindowWidth();
  const drawnWidth = effectiveSidebarWidth(width, windowWidth);
  const [confirmSnippet, setConfirmSnippet] = useState<Snippet | null>(null);
  const [dragging, setDragging] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  // The width is dynamic, so it goes in a CSS variable (w-(--sidebar-w)) rather than a style prop.
  useLayoutEffect(() => {
    asideRef.current?.style.setProperty('--sidebar-w', `${drawnWidth}px`);
  }, [drawnWidth, collapsed]);

  const vaultMenu: MenuEntry[] = [
    { id: 'switch', label: 'Switch Vault…', onSelect: requestVaultSwitch },
  ];
  const snippetMenu: MenuEntry[] = snippets.map((s) => ({
    id: s.id,
    label: s.name,
    onSelect: () => setConfirmSnippet(s),
  }));

  // ── Resize handle: pointer drag, arrow keys, double-click to reset ──
  const onResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = drawnWidth;
    let latest = startWidth;
    setDragging(true);
    const onMove = (ev: PointerEvent) => {
      latest = startWidth + ev.clientX - startX;
      setSidebarWidth(latest);
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      setDragging(false);
      setSidebarWidth(latest, true);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  const onResizeKeyDown = (e: React.KeyboardEvent) => {
    const next = sidebarWidthForKey(drawnWidth, e.key, e.shiftKey);
    if (next === null) return;
    e.preventDefault();
    setSidebarWidth(next, true);
  };

  const navButtonClass = (active: boolean) =>
    cx(
      'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-body font-medium',
      'transition-colors duration-(--duration-fast) ease-standard focus-ring-inset',
      active
        ? 'bg-accent-soft text-accent'
        : 'text-fg-secondary hover:bg-surface-hover hover:text-fg'
    );

  const snippetDialog = (
    <RunSnippetDialog snippet={confirmSnippet} onClose={() => setConfirmSnippet(null)} />
  );

  if (collapsed) {
    return (
      <aside
        aria-label="Sidebar"
        className="no-select flex w-12 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-sunken py-2"
      >
        <IconButton icon={PanelLeftOpen} label="Expand sidebar" onClick={toggleSidebar} />
        <Menu
          items={vaultMenu}
          label="Vault"
          trigger={(p) => (
            <IconButton
              {...p}
              icon={Lock}
              label={vaultName ? `Vault menu (${vaultName})` : 'Vault menu'}
            />
          )}
        />
        <div className="my-1 h-px w-6 bg-line" aria-hidden="true" />
        <nav aria-label="Main" className="flex flex-col items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = currentView === item.key;
            return (
              <IconButton
                key={item.key}
                icon={item.icon}
                label={item.label}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent'
                    : undefined
                }
                onClick={() => setView(item.key)}
              />
            );
          })}
        </nav>
        <div className="my-1 h-px w-6 bg-line" aria-hidden="true" />
        <Menu
          items={snippetMenu}
          label="Snippets"
          trigger={(p) => (
            <IconButton
              {...p}
              icon={Play}
              label="Run snippet"
              disabled={snippets.length === 0}
            />
          )}
        />
        <div className="flex-1" />
        <SyncStatusBadge compact />
        {snippetDialog}
      </aside>
    );
  }

  return (
    <aside
      ref={asideRef}
      aria-label="Sidebar"
      className={cx(
        'no-select relative flex w-(--sidebar-w) shrink-0 flex-col border-r border-line bg-surface-sunken',
        !dragging && 'sidebar-transition'
      )}
    >
      {/* Vault menu + collapse */}
      <div className="flex h-11 shrink-0 items-center gap-1 px-2">
        <Menu
          className="flex min-w-0 flex-1"
          items={vaultMenu}
          label="Vault"
          trigger={(p) => (
            <button
              {...p}
              type="button"
              title="Vault menu"
              className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-body font-semibold text-fg transition-colors duration-(--duration-fast) hover:bg-surface-hover focus-ring-inset"
            >
              <Icon icon={Lock} size={14} className="shrink-0 text-fg-muted" />
              <span className="min-w-0 flex-1 truncate">{vaultName || 'Vault'}</span>
              <Icon icon={ChevronDown} size={12} className="shrink-0 text-fg-muted" />
            </button>
          )}
        />
        <IconButton
          icon={PanelLeftClose}
          size="sm"
          label="Collapse sidebar"
          onClick={toggleSidebar}
        />
      </div>

      {/* Navigation */}
      <nav aria-label="Main" className="flex flex-col gap-0.5 px-2 pt-1">
        {NAV_ITEMS.map((item) => {
          const active = currentView === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => setView(item.key)}
              className={navButtonClass(active)}
            >
              <Icon icon={item.icon} size={16} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Quick snippet runner */}
      <div className="mx-2 mt-3 border-t border-line pt-3">
        <Menu
          className="flex w-full"
          items={snippetMenu}
          label="Snippets"
          trigger={(p) => (
            <button
              {...p}
              type="button"
              disabled={snippets.length === 0}
              title={snippets.length === 0 ? 'No snippets yet' : undefined}
              className={cx(
                navButtonClass(false),
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              <Icon icon={Play} size={16} className="shrink-0" />
              <span className="flex-1 truncate">Run Snippet</span>
              <Icon icon={ChevronDown} size={12} className="shrink-0 text-fg-muted" />
            </button>
          )}
        />
      </div>

      <div className="flex-1" />

      <div className="border-t border-line">
        <SyncStatusBadge />
      </div>

      {/* Resize handle on the right edge */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={drawnWidth}
        tabIndex={0}
        title="Drag to resize, double-click to reset"
        onPointerDown={onResizePointerDown}
        onKeyDown={onResizeKeyDown}
        onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH, true)}
        className={cx(
          'absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize focus-ring-inset',
          'transition-colors duration-(--duration-fast) hover:bg-accent/40',
          dragging && 'bg-accent/40'
        )}
      />

      {snippetDialog}
    </aside>
  );
};

/** "Run <snippet>?" confirmation: shows the command and the session it will be typed into. */
function RunSnippetDialog({
  snippet,
  onClose,
}: {
  snippet: Snippet | null;
  onClose: () => void;
}) {
  const addNotification = useUIStore((s) => s.addNotification);
  const hosts = useVaultStore((s) => s.hosts);
  const sessions = useTerminalStore((s) => s.sessions);
  const activeSessionId = useTerminalStore((s) => s.activeSessionId);
  const writeToSession = useTerminalStore((s) => s.writeToSession);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeHost = activeSession
    ? hosts.find((h) => h.id === activeSession.hostId)
    : null;

  const run = () => {
    if (!snippet || !activeSessionId) return;
    for (const line of snippet.command.split('\n'))
      writeToSession(activeSessionId, line + '\n');
    addNotification('success', `Ran "${snippet.name}"`);
    onClose();
  };

  return (
    <Dialog
      open={snippet !== null}
      onClose={onClose}
      title={snippet ? `Run "${snippet.name}"?` : ''}
      description={snippet?.description || undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={run} disabled={!activeSessionId}>
            Run
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-body-sm font-medium text-fg-secondary">Command</div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface-sunken p-2 font-code text-body-sm text-fg">
            {snippet?.command}
          </pre>
        </div>
        <div className="rounded-md border border-line bg-surface-sunken px-3 py-2 text-body-sm">
          {activeSession && activeHost ? (
            <span className="text-fg-secondary">
              Will run in{' '}
              <span className="font-semibold text-fg">{activeHost.label}</span>{' '}
              <span className="font-code text-fg-muted">({activeHost.hostname})</span>
            </span>
          ) : (
            <span className="text-danger">
              No active terminal session. Connect to a host first.
            </span>
          )}
        </div>
      </div>
    </Dialog>
  );
}
