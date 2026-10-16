import React, { useState, useMemo, useCallback } from 'react';
import { useVaultStore, useTerminalStore, useUIStore } from '../../stores';
import type { Host, Group } from '../../../shared/types';
import { HostForm } from './HostForm';
import { GroupForm } from './GroupForm';
import {
  Apple,
  Ellipsis,
  FolderPlus,
  FolderSync,
  Grid2x2,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Search,
  SearchX,
  Server,
  SquareTerminal,
} from 'lucide-react';
import { Icon } from '../common/Icon';
import { Button, EmptyState, IconButton, Input, Menu, Select, Toolbar, cx, type MenuEntry } from '../ui';

// ============================================================
// ConnectionsView — the Hosts view (and the SFTP host picker): toolbar, group filter chips,
// and the hosts as a grid of cards or a list. Fits a 560 px main area (#2365): the toolbar
// wraps, the chips scroll sideways, and long names / hostnames truncate with a tooltip.
// ============================================================

type ViewMode = 'grid' | 'list';
type SortField = 'label' | 'hostname' | 'last_connected';

const SORT_OPTIONS = [
  { value: 'label', label: 'Name' },
  { value: 'hostname', label: 'Hostname' },
  { value: 'last_connected', label: 'Recent' },
];

export interface ConnectionsViewProps {
  mode?: 'ssh' | 'sftp';
}

export function ConnectionsView({ mode = 'ssh' }: ConnectionsViewProps = {}): React.ReactElement {
  const hosts = useVaultStore((s) => s.hosts);
  const groups = useVaultStore((s) => s.groups);
  const sessions = useTerminalStore((s) => s.sessions);
  const connectSession = useTerminalStore((s) => s.connectSession);
  const openSftpSession = useTerminalStore((s) => s.openSftpSession);
  const setView = useUIStore((s) => s.setView);

  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortBy, setSortBy] = useState<SortField>('label');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [showNewHost, setShowNewHost] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);

  const connectedHostIds = useMemo(
    () => new Set(sessions.filter((s) => s.connected).map((s) => s.hostId)),
    [sessions],
  );

  const groupMap = useMemo(() => {
    const map = new Map<string, Group>();
    groups.forEach((g) => map.set(g.id, g));
    return map;
  }, [groups]);

  // A filter on a group that has since been deleted falls back to "All".
  const activeGroup = selectedGroup && groupMap.has(selectedGroup) ? selectedGroup : null;

  const hostCountByGroup = useMemo(() => {
    const counts = new Map<string, number>();
    hosts.forEach((h) => {
      if (h.group_id) counts.set(h.group_id, (counts.get(h.group_id) ?? 0) + 1);
    });
    return counts;
  }, [hosts]);

  // Filter and sort hosts
  const filteredHosts = useMemo(() => {
    let result = [...hosts];

    if (activeGroup) {
      result = result.filter((h) => h.group_id === activeGroup);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (h) =>
          h.label.toLowerCase().includes(q) ||
          h.hostname.toLowerCase().includes(q) ||
          (h.username && h.username.toLowerCase().includes(q)),
      );
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case 'label':
          return a.label.localeCompare(b.label);
        case 'hostname':
          return a.hostname.localeCompare(b.hostname);
        case 'last_connected':
          return (b.last_connected || '').localeCompare(a.last_connected || '');
        default:
          return 0;
      }
    });

    return result;
  }, [hosts, search, sortBy, activeGroup]);

  const openTerminal = useCallback(
    (host: Host) => {
      connectSession(host.id);
      setView('terminal');
    },
    [connectSession, setView],
  );

  const openSftp = useCallback(
    (host: Host) => {
      openSftpSession(host.id);
      setView('sftp');
    },
    [openSftpSession, setView],
  );

  // Clicking a host: a terminal from the Hosts view, an SFTP browser from the SFTP picker.
  const handleConnect = mode === 'sftp' ? openSftp : openTerminal;

  const hostActions = useCallback(
    (host: Host): MenuEntry[] => [
      { id: 'terminal', label: 'Open terminal', icon: SquareTerminal, onSelect: () => openTerminal(host) },
      { id: 'sftp', label: 'Open SFTP', icon: FolderSync, onSelect: () => openSftp(host) },
      { separator: true, id: 'sep' },
      { id: 'edit', label: 'Edit host…', icon: Pencil, onSelect: () => setEditingHost(host) },
    ],
    [openTerminal, openSftp],
  );

  const itemProps = (host: Host) => ({
    host,
    group: host.group_id ? groupMap.get(host.group_id) : undefined,
    connected: connectedHostIds.has(host.id),
    actions: hostActions(host),
    onConnect: handleConnect,
    onEdit: setEditingHost,
  });

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      {/* Toolbar: wraps onto a second row in narrow windows instead of squashing (#2365) */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate text-heading-sm font-semibold text-fg">
            {mode === 'sftp' ? 'SFTP — Select Host' : 'Hosts'}
          </h2>
          <span className="shrink-0 text-body-sm text-fg-muted">
            {filteredHosts.length} host{filteredHosts.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="primary" icon={Plus} onClick={() => setShowNewHost(true)}>
            New Host
          </Button>
          <Button icon={FolderPlus} onClick={() => setShowNewGroup(true)}>
            New Group
          </Button>
        </div>

        {/* Search, sort and the layout toggle stay together and wrap as a unit. */}
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          <div className="w-48 min-w-0 shrink">
            <Input
              leadingIcon={Search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search hosts..."
              aria-label="Search hosts"
            />
          </div>
          <div className="w-32 shrink-0">
            <Select
              options={SORT_OPTIONS}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortField)}
              aria-label="Sort hosts by"
            />
          </div>
          <Toolbar label="Layout">
            <IconButton
              icon={LayoutGrid}
              label="Grid view"
              pressed={viewMode === 'grid'}
              onClick={() => setViewMode('grid')}
            />
            <IconButton
              icon={List}
              label="List view"
              pressed={viewMode === 'list'}
              onClick={() => setViewMode('list')}
            />
          </Toolbar>
        </div>
      </div>

      {/* Group filter chips: scroll sideways when there are more than fit */}
      {groups.length > 0 && (
        <div
          role="group"
          aria-label="Filter by group"
          className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line px-4 py-2 scrollbar-thin"
        >
          <GroupChip active={activeGroup === null} count={hosts.length} onClick={() => setSelectedGroup(null)}>
            All
          </GroupChip>
          {groups.map((group) => (
            <GroupChip
              key={group.id}
              active={activeGroup === group.id}
              count={hostCountByGroup.get(group.id) ?? 0}
              title={`${group.name} (right-click to edit)`}
              onClick={() => setSelectedGroup(group.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setEditingGroup(group);
              }}
            >
              {/* The group's icon is an emoji the user chose: data, not an app icon. */}
              {group.icon && <span aria-hidden="true">{group.icon}</span>}
              <span className="truncate">{group.name}</span>
            </GroupChip>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {filteredHosts.length === 0 ? (
          hosts.length === 0 ? (
            <EmptyState
              icon={Server}
              title="No connections yet"
              description={
                <>
                  Add your first server with <span className="font-medium text-fg-secondary">New Host</span>.
                </>
              }
              className="h-full"
            />
          ) : search.trim() ? (
            <EmptyState
              icon={SearchX}
              title={`No hosts match “${search}”`}
              description="Try a different search term."
              action={<Button onClick={() => setSearch('')}>Clear search</Button>}
              className="h-full"
            />
          ) : (
            <EmptyState
              icon={Server}
              title="No hosts in this group"
              description="Add a host to the group from its host settings."
              action={<Button onClick={() => setSelectedGroup(null)}>Show all hosts</Button>}
              className="h-full"
            />
          )
        ) : viewMode === 'grid' ? (
          <ul className="grid grid-cols-cards gap-3">
            {filteredHosts.map((host) => (
              <HostCard key={host.id} {...itemProps(host)} />
            ))}
          </ul>
        ) : (
          <ul className="@container flex flex-col gap-0.5">
            {filteredHosts.map((host) => (
              <HostRow key={host.id} {...itemProps(host)} />
            ))}
          </ul>
        )}
      </div>

      {/* New Host modal */}
      <HostForm open={showNewHost} onClose={() => setShowNewHost(false)} />

      {/* Edit Host modal */}
      {editingHost && <HostForm open={true} host={editingHost} onClose={() => setEditingHost(null)} />}

      {/* New Group modal */}
      <GroupForm open={showNewGroup} onClose={() => setShowNewGroup(false)} />

      {/* Edit Group modal */}
      {editingGroup && <GroupForm open={true} group={editingGroup} onClose={() => setEditingGroup(null)} />}
    </div>
  );
}

// ── Group chip ──────────────────────────────────────────────

interface GroupChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  active: boolean;
  count: number;
}

function GroupChip({ active, count, className, children, ...rest }: GroupChipProps): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cx(
        'inline-flex h-6 max-w-48 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-body-sm font-medium',
        'transition-colors duration-(--duration-fast) ease-standard focus-ring',
        active
          ? 'border-transparent bg-accent-soft text-accent'
          : 'border-line-strong text-fg-secondary hover:bg-surface-hover hover:text-fg',
        className,
      )}
      {...rest}
    >
      {children}
      <span className={cx('shrink-0 tabular-nums', active ? 'text-accent' : 'text-fg-muted')}>{count}</span>
    </button>
  );
}

// ── Host items ──────────────────────────────────────────────

interface HostItemProps {
  host: Host;
  group?: Group;
  connected: boolean;
  /** The "More actions" menu. */
  actions: MenuEntry[];
  onConnect: (host: Host) => void;
  onEdit: (host: Host) => void;
}

/** user@hostname, or just the hostname. */
function address(host: Host): string {
  return `${host.username ? `${host.username}@` : ''}${host.hostname}`;
}

/**
 * The per-host "More actions" button. Hidden until the item is hovered or anything in it has
 * keyboard focus (group-focus-within), so it's reachable without a mouse. It comes after the
 * host's own button in the DOM, so "first button named <host>" is still the host.
 */
function HostActions({ host, actions, className }: { host: Host; actions: MenuEntry[]; className?: string }) {
  return (
    <div
      className={cx(
        'opacity-0 transition-opacity duration-(--duration-fast) ease-standard group-hover:opacity-100 group-focus-within:opacity-100',
        className,
      )}
    >
      <Menu
        align="end"
        label={`Actions for ${host.label}`}
        items={actions}
        trigger={(p) => <IconButton {...p} icon={Ellipsis} label={`More actions for ${host.label}`} size="sm" />}
      />
    </div>
  );
}

function HostCard({ host, group, connected, actions, onConnect, onEdit }: HostItemProps): React.ReactElement {
  return (
    <li
      className={cx(
        'group relative min-w-0 rounded-lg border border-line bg-surface-raised shadow-raised',
        'transition-colors duration-(--duration-fast) ease-standard hover:border-line-strong focus-within:border-line-strong',
      )}
    >
      {host.colour && <ColourMark colour={host.colour} className="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-lg" />}

      <button
        type="button"
        onClick={() => onConnect(host)}
        onContextMenu={(e) => {
          e.preventDefault();
          onEdit(host);
        }}
        className="flex w-full min-w-0 flex-col gap-2 rounded-lg p-3 pr-10 text-left transition-colors duration-(--duration-fast) hover:bg-surface-hover focus-ring"
      >
        <span className="flex w-full min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface text-fg-muted">
            <OSIcon osType={host.os_type} size={16} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-body font-semibold text-fg" title={host.label}>
                {host.label}
              </span>
              {connected && <ConnectedDot />}
            </span>
            <span className="truncate font-code text-body-sm text-fg-muted" title={address(host)}>
              {address(host)}
            </span>
          </span>
        </span>

        <span className="flex w-full min-w-0 items-center gap-1.5 text-caption text-fg-muted">
          <span className="shrink-0 rounded-sm bg-surface px-1.5 font-code">:{host.port}</span>
          {group && (
            <span className="min-w-0 truncate rounded-sm bg-surface px-1.5" title={group.name}>
              {group.name}
            </span>
          )}
          {host.last_connected && (
            <span className="ml-auto shrink-0">{formatRelativeTime(host.last_connected)}</span>
          )}
        </span>
      </button>

      <HostActions host={host} actions={actions} className="absolute top-2 right-2" />
    </li>
  );
}

function HostRow({ host, group, connected, actions, onConnect, onEdit }: HostItemProps): React.ReactElement {
  return (
    <li className="group relative flex min-w-0 items-center rounded-md transition-colors duration-(--duration-fast) hover:bg-surface-hover focus-within:bg-surface-hover">
      <button
        type="button"
        onClick={() => onConnect(host)}
        onContextMenu={(e) => {
          e.preventDefault();
          onEdit(host);
        }}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-1.5 pr-2 pl-3 text-left focus-ring-inset"
      >
        {host.colour ? (
          <ColourMark colour={host.colour} className="size-2 shrink-0 rounded-full" />
        ) : (
          <span className="size-2 shrink-0 rounded-full bg-fg-muted" aria-hidden="true" />
        )}

        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-raised text-fg-muted">
          <OSIcon osType={host.os_type} size={14} />
        </span>

        <span className="w-40 min-w-16 shrink truncate text-body font-medium text-fg" title={host.label}>
          {host.label}
        </span>

        <span
          className="min-w-0 flex-1 truncate font-code text-body-sm text-fg-muted"
          title={`${address(host)}:${host.port}`}
        >
          {address(host)}:{host.port}
        </span>

        {/* The group column only shows when the list is wide enough for it. */}
        <span className="hidden w-28 shrink-0 truncate text-body-sm text-fg-muted @xl:block" title={group?.name}>
          {group?.name || '—'}
        </span>

        {connected && (
          <span className="flex shrink-0 items-center gap-1 text-caption text-success">
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
            Connected
          </span>
        )}

        <span className="w-14 shrink-0 text-right text-caption text-fg-muted">
          {host.last_connected ? formatRelativeTime(host.last_connected) : ''}
        </span>
      </button>

      <HostActions host={host} actions={actions} className="mr-1 shrink-0" />
    </li>
  );
}

function ConnectedDot(): React.ReactElement {
  return (
    <>
      <span className="size-2 shrink-0 rounded-full bg-success" title="Connected" aria-hidden="true" />
      <span className="sr-only">Connected</span>
    </>
  );
}

/**
 * A host's colour mark. The colour is user data (any hex from the colour picker), not a theme
 * colour, so no token can express it: this is the view's one inline style, as in the shell's
 * session tabs.
 */
function ColourMark({ colour, className }: { colour: string; className: string }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={className}
      // eslint-disable-next-line no-restricted-syntax -- the host's colour is user data, not a theme colour
      style={{ backgroundColor: colour }}
    />
  );
}

// ── OS Icon ─────────────────────────────────────────────────

function OSIcon({ osType, size = 16 }: { osType: string | null; size?: number }): React.ReactElement {
  const icon =
    osType === 'linux' ? SquareTerminal : osType === 'windows' ? Grid2x2 : osType === 'macos' ? Apple : Server;
  return <Icon icon={icon} size={size} />;
}

// ── Helpers ──────────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default ConnectionsView;
