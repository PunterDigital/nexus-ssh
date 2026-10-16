import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FolderSync,
  ListChevronsUpDown,
  Terminal,
  X,
} from 'lucide-react';
import { useTerminalStore, useUIStore } from '../../stores';
import type { TerminalTab } from '../../stores/terminal-store';
import { IconButton, Menu, cx, type MenuEntry } from '../ui';
import { Icon } from '../common/Icon';

// ============================================================
// SessionTabs — the header's open terminal / SFTP sessions (#2365).
// Tabs keep a readable minimum width and scroll sideways when they don't fit; then scroll
// buttons and an "All sessions" menu appear, and the active tab is always scrolled into view.
// Keyboard: one tab stop; ←/→/Home/End move focus between tabs and Enter / Space opens one
// (manual activation: opening a terminal tab moves focus into the terminal); Delete closes it.
// ============================================================

export const SessionTabs: React.FC = () => {
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const setActiveTab = useTerminalStore((s) => s.setActiveTab);
  const removeTab = useTerminalStore((s) => s.removeTab);
  const sessions = useTerminalStore((s) => s.sessions);
  const currentView = useUIStore((s) => s.currentView);
  const setView = useUIStore((s) => s.setView);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const viewFor = (tab: TerminalTab) => (tab.type === 'sftp' ? 'sftp' : 'terminal');
  const isActive = (tab: TerminalTab) =>
    tab.id === activeTabId && currentView === viewFor(tab);

  const activate = (tab: TerminalTab) => {
    setActiveTab(tab.id);
    setView(viewFor(tab));
  };

  const close = (tab: TerminalTab) => {
    const wasShown = isActive(tab);
    removeTab(tab.id);
    const { tabs: left, activeTabId: nextId } = useTerminalStore.getState();
    const next = left.find((t) => t.id === nextId);
    if (!next) {
      // Last tab: back to the host list for that mode
      setView(tab.type === 'sftp' ? 'sftp' : 'connections');
    } else if (wasShown) {
      setView(viewFor(next));
    }
  };

  const updateOverflow = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const left = el.scrollLeft > 0;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setOverflow((o) => (o.left === left && o.right === right ? o : { left, right }));
  }, []);

  // Re-measure after every render (tabs added or removed, scroll buttons shown or hidden, which
  // changes the strip's width) and whenever the window resizes. setOverflow skips no-op updates.
  useLayoutEffect(updateOverflow);

  // The strip only exists while there are tabs, so re-attach the observer when it appears.
  const hasTabs = tabs.length > 0;
  useEffect(() => {
    const el = scrollerRef.current;
    const observer = new ResizeObserver(updateOverflow);
    if (el) observer.observe(el);
    window.addEventListener('resize', updateOverflow);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateOverflow);
    };
  }, [updateOverflow, hasTabs]);

  // Keep the active tab in view (opening a tab, picking one from the menu, keyboard moves).
  useEffect(() => {
    if (!activeTabId) return;
    scrollerRef.current
      ?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId, tabs.length]);

  if (tabs.length === 0) {
    return (
      <span className="min-w-0 flex-1 truncate text-body-sm text-fg-muted">
        No open sessions
      </span>
    );
  }

  const scrollBy = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    el?.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.6), behavior: 'smooth' });
  };

  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    const go = (i: number) => {
      const tab = tabs[(i + tabs.length) % tabs.length];
      const el = scrollerRef.current?.querySelector<HTMLElement>(
        `[data-tab-id="${CSS.escape(tab.id)}"] [role="tab"]`
      );
      el?.focus();
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        go(index + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        go(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        go(0);
        break;
      case 'End':
        e.preventDefault();
        go(tabs.length - 1);
        break;
      case 'Delete':
        e.preventDefault();
        close(tabs[index]);
        break;
    }
  };

  const allSessions: MenuEntry[] = tabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    icon: tab.type === 'sftp' ? FolderSync : Terminal,
    onSelect: () => activate(tab),
  }));

  // Exactly one tab is focusable: the active one, else the first.
  const focusableId = tabs.some(isActive) ? activeTabId : tabs[0].id;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {overflow.left && (
        <IconButton
          icon={ChevronLeft}
          size="sm"
          label="Scroll tabs left"
          onClick={() => scrollBy(-1)}
        />
      )}

      <div
        ref={scrollerRef}
        role="tablist"
        aria-label="Open sessions"
        onScroll={updateOverflow}
        onWheel={(e) => {
          // A vertical wheel scrolls the strip sideways.
          if (e.deltaY !== 0 && e.deltaX === 0) e.currentTarget.scrollLeft += e.deltaY;
        }}
        className="scrollbar-hidden flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      >
        {tabs.map((tab, index) => {
          const active = isActive(tab);
          const session = tab.sessionId
            ? sessions.find((s) => s.id === tab.sessionId)
            : null;
          const disconnected =
            session != null && !session.connected && session.status !== 'connecting';
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              className={cx(
                'group flex h-8 w-44 min-w-28 shrink-0 items-center rounded-md transition-colors duration-(--duration-fast)',
                active
                  ? 'bg-surface text-fg shadow-raised'
                  : 'text-fg-secondary hover:bg-surface-hover hover:text-fg'
              )}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  close(tab);
                }
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={tab.id === focusableId ? 0 : -1}
                title={
                  session?.hostname ? `${tab.label} (${session.hostname})` : tab.label
                }
                onClick={() => activate(tab)}
                onKeyDown={(e) => onTabKeyDown(e, index)}
                className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pl-2.5 pr-1 text-left text-body-sm focus-ring-inset"
              >
                {tab.colour ? (
                  <span
                    className="size-2 shrink-0 rounded-full"
                    // eslint-disable-next-line no-restricted-syntax -- the host's colour is user data, not a theme colour
                    style={{ backgroundColor: tab.colour }}
                    aria-hidden="true"
                  />
                ) : (
                  <Icon
                    icon={tab.type === 'sftp' ? FolderSync : Terminal}
                    size={12}
                    className={cx(
                      'shrink-0',
                      disconnected ? 'text-danger' : 'text-fg-muted'
                    )}
                  />
                )}
                <span
                  className={cx('truncate', disconnected && 'line-through opacity-70')}
                >
                  {tab.label}
                </span>
              </button>
              <IconButton
                icon={X}
                size="sm"
                label={`Close ${tab.label}`}
                tabIndex={-1}
                onClick={() => close(tab)}
                className={cx(
                  'mr-1',
                  !active && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                )}
              />
            </div>
          );
        })}
      </div>

      {overflow.right && (
        <IconButton
          icon={ChevronRight}
          size="sm"
          label="Scroll tabs right"
          onClick={() => scrollBy(1)}
        />
      )}
      {(overflow.left || overflow.right) && (
        <Menu
          align="end"
          label="All sessions"
          items={allSessions}
          trigger={(p) => (
            <IconButton {...p} icon={ListChevronsUpDown} size="sm" label="All sessions" />
          )}
        />
      )}
    </div>
  );
};
