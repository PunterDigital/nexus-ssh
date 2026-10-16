import React, { useState, useMemo, useCallback } from 'react';
import { useVaultStore, useTerminalStore, useUIStore } from '../../stores';
import type { Host, Group, Vault } from '../../../shared/types';
import { HostForm } from './HostForm';
import { GroupForm } from './GroupForm';
import { Apple, ChevronRight, FolderPlus, Grid2x2, LayoutGrid, List, Plus, Search, Server, SquareTerminal } from 'lucide-react';
import { Icon } from '../common/Icon';

// ============================================================
// ConnectionsView — Termius-style grid of host cards
// ============================================================

type ViewMode = 'grid' | 'list';
type SortField = 'label' | 'hostname' | 'last_connected';

export interface ConnectionsViewProps {
  mode?: 'ssh' | 'sftp';
}

export function ConnectionsView({ mode = 'ssh' }: ConnectionsViewProps = {}): React.ReactElement {
  const hosts = useVaultStore((s) => s.hosts);
  const groups = useVaultStore((s) => s.groups);
  const vaults = useVaultStore((s) => s.vaults);
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

  const vaultMap = useMemo(() => {
    const map = new Map<string, Vault>();
    vaults.forEach((v) => map.set(v.id, v));
    return map;
  }, [vaults]);

  // Filter and sort hosts
  const filteredHosts = useMemo(() => {
    let result = [...hosts];

    // Group filter
    if (selectedGroup) {
      result = result.filter((h) => h.group_id === selectedGroup);
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (h) =>
          h.label.toLowerCase().includes(q) ||
          h.hostname.toLowerCase().includes(q) ||
          (h.username && h.username.toLowerCase().includes(q)),
      );
    }

    // Sort
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
  }, [hosts, search, sortBy, selectedGroup]);

  const handleConnect = useCallback(
    (host: Host) => {
      console.log(`[ConnectionsView] handleConnect mode=${mode} host=${host.label}`);
      if (mode === 'sftp') {
        openSftpSession(host.id);
      } else {
        connectSession(host.id);
        setView('terminal');
      }
    },
    [mode, connectSession, openSftpSession, setView],
  );

  const handleEdit = useCallback((host: Host) => {
    setEditingHost(host);
  }, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--color-bg-primary)]">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-3">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {mode === 'sftp' ? 'SFTP — Select Host' : 'Hosts'}
        </h2>
        <span className="text-xs text-[var(--color-text-muted)]">
          {filteredHosts.length} host{filteredHosts.length !== 1 ? 's' : ''}
        </span>

        {/* New Host button */}
        <button
          onClick={() => setShowNewHost(true)}
          className="flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 active:scale-[0.97]"
        >
          <Icon icon={Plus} size={12} />
          New Host
        </button>

        {/* New Group button */}
        <button
          onClick={() => setShowNewGroup(true)}
          className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] active:scale-[0.97]"
        >
          <Icon icon={FolderPlus} size={12} />
          New Group
        </button>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <Icon
            icon={Search}
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search hosts..."
            className="input h-8 w-56 text-xs"
            style={{ paddingLeft: '30px' }}
          />
        </div>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortField)}
          className="input h-8 w-32 text-xs"
        >
          <option value="label">Name</option>
          <option value="hostname">Hostname</option>
          <option value="last_connected">Recent</option>
        </select>

        {/* View toggle */}
        <div className="flex overflow-hidden rounded border border-[var(--color-border)]">
          <button
            onClick={() => setViewMode('grid')}
            className={`px-2 py-1 transition-colors ${
              viewMode === 'grid'
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)]'
            }`}
            title="Grid view"
          >
            <GridIcon />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-2 py-1 transition-colors ${
              viewMode === 'list'
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)]'
            }`}
            title="List view"
          >
            <ListIcon />
          </button>
        </div>
      </div>

      {/* Groups chip bar */}
      {groups.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-[var(--color-border)] px-5 py-2 scrollbar-hidden">
          <button
            onClick={() => setSelectedGroup(null)}
            className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              selectedGroup === null
                ? 'bg-[var(--color-accent)] text-white'
                : 'border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            All
            <span className="ml-1.5 opacity-70">{hosts.length}</span>
          </button>
          {groups.map((group) => {
            const groupHostCount = hosts.filter((h) => h.group_id === group.id).length;
            const isActive = selectedGroup === group.id;
            return (
              <button
                key={group.id}
                onClick={() => setSelectedGroup(group.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setEditingGroup(group);
                }}
                title="Right-click to edit"
                className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {group.icon && <span className="mr-1">{group.icon}</span>}
                {group.name}
                <span className="ml-1.5 opacity-70">{groupHostCount}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {filteredHosts.length === 0 ? (
          <EmptyState hasHosts={hosts.length > 0} search={search} />
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {filteredHosts.map((host) => (
              <HostCard
                key={host.id}
                host={host}
                group={host.group_id ? groupMap.get(host.group_id) : undefined}
                vault={vaultMap.get(host.vault_id)}
                connected={connectedHostIds.has(host.id)}
                onConnect={handleConnect}
                onEdit={handleEdit}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {filteredHosts.map((host) => (
              <HostRow
                key={host.id}
                host={host}
                group={host.group_id ? groupMap.get(host.group_id) : undefined}
                connected={connectedHostIds.has(host.id)}
                onConnect={handleConnect}
                onEdit={handleEdit}
              />
            ))}
          </div>
        )}
      </div>

      {/* New Host modal */}
      <HostForm
        open={showNewHost}
        onClose={() => setShowNewHost(false)}
      />

      {/* Edit Host modal */}
      {editingHost && (
        <HostForm
          open={true}
          host={editingHost}
          onClose={() => setEditingHost(null)}
        />
      )}

      {/* New Group modal */}
      <GroupForm open={showNewGroup} onClose={() => setShowNewGroup(false)} />

      {/* Edit Group modal */}
      {editingGroup && (
        <GroupForm
          open={true}
          group={editingGroup}
          onClose={() => setEditingGroup(null)}
        />
      )}
    </div>
  );
}

// ── Host Card (grid view) ───────────────────────────────────

interface HostCardProps {
  host: Host;
  group?: Group;
  vault?: Vault;
  connected: boolean;
  onConnect: (host: Host) => void;
  onEdit: (host: Host) => void;
}

function HostCard({ host, group, connected, onConnect, onEdit }: HostCardProps): React.ReactElement {
  return (
    <button
      onClick={() => onConnect(host)}
      onContextMenu={(e) => {
        e.preventDefault();
        onEdit(host);
      }}
      className="group relative flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-left transition-all hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-tertiary)] hover:shadow-lg hover:shadow-[var(--color-accent)]/5 active:scale-[0.98]"
    >
      {/* Colour accent bar */}
      {host.colour && (
        <div
          className="absolute left-0 top-0 h-full w-1 rounded-l-lg"
          style={{ backgroundColor: host.colour }}
        />
      )}

      {/* Top row: icon + status */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-bg-primary)]">
          <OSIcon osType={host.os_type} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
              {host.label}
            </span>
            {connected && (
              <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-[var(--color-success)]" title="Connected" />
            )}
          </div>
          <span className="block truncate text-xs text-[var(--color-text-muted)]">
            {host.username ? `${host.username}@` : ''}{host.hostname}
          </span>
        </div>
      </div>

      {/* Details */}
      <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
        <span className="rounded bg-[var(--color-bg-primary)] px-1.5 py-0.5">
          :{host.port}
        </span>
        {group && (
          <span className="truncate rounded bg-[var(--color-bg-primary)] px-1.5 py-0.5">
            {group.name}
          </span>
        )}
        {host.last_connected && (
          <span className="ml-auto flex-shrink-0">
            {formatRelativeTime(host.last_connected)}
          </span>
        )}
      </div>

      {/* Hover connect indicator */}
      <div className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100">
        <Icon icon={ChevronRight} size={16} color="var(--color-accent)" />
      </div>
    </button>
  );
}

// ── Host Row (list view) ────────────────────────────────────

interface HostRowProps {
  host: Host;
  group?: Group;
  connected: boolean;
  onConnect: (host: Host) => void;
  onEdit: (host: Host) => void;
}

function HostRow({ host, group, connected, onConnect, onEdit }: HostRowProps): React.ReactElement {
  return (
    <button
      onClick={() => onConnect(host)}
      onContextMenu={(e) => {
        e.preventDefault();
        onEdit(host);
      }}
      className="group flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-[var(--color-bg-tertiary)] active:scale-[0.995]"
    >
      {/* Colour dot */}
      <span
        className="h-2 w-2 flex-shrink-0 rounded-full"
        style={{ backgroundColor: host.colour || 'var(--color-text-muted)' }}
      />

      {/* OS icon */}
      <div className="flex h-7 w-7 items-center justify-center rounded bg-[var(--color-bg-secondary)]">
        <OSIcon osType={host.os_type} size={14} />
      </div>

      {/* Label */}
      <span className="w-40 truncate text-sm font-medium text-[var(--color-text-primary)]">
        {host.label}
      </span>

      {/* Hostname */}
      <span className="w-48 truncate text-xs text-[var(--color-text-muted)]">
        {host.username ? `${host.username}@` : ''}{host.hostname}:{host.port}
      </span>

      {/* Group */}
      <span className="w-28 truncate text-xs text-[var(--color-text-muted)]">
        {group?.name || '—'}
      </span>

      {/* Status */}
      {connected && (
        <span className="flex items-center gap-1 text-[10px] text-[var(--color-success)]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
          Connected
        </span>
      )}

      {/* Last connected */}
      <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">
        {host.last_connected ? formatRelativeTime(host.last_connected) : ''}
      </span>

      {/* Connect arrow */}
      <div className="opacity-0 transition-opacity group-hover:opacity-100">
        <Icon icon={ChevronRight} size={14} color="var(--color-accent)" />
      </div>
    </button>
  );
}

// ── Empty state ─────────────────────────────────────────────

function EmptyState({ hasHosts, search }: { hasHosts: boolean; search: string }): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-[var(--color-text-muted)]">
        <Icon icon={SquareTerminal} size={48} strokeWidth={1.5} className="opacity-30" />
        {hasHosts ? (
          <>
            <span className="text-sm">No hosts match &ldquo;{search}&rdquo;</span>
            <span className="text-xs">Try a different search term</span>
          </>
        ) : (
          <>
            <span className="text-sm">No connections yet</span>
            <span className="text-xs">Add a host from the sidebar to get started</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── OS Icon ─────────────────────────────────────────────────

function OSIcon({ osType, size = 18 }: { osType: string | null; size?: number }): React.ReactElement {
  const icon =
    osType === 'linux' ? SquareTerminal : osType === 'windows' ? Grid2x2 : osType === 'macos' ? Apple : Server;
  return <Icon icon={icon} size={size} className="text-[var(--color-text-muted)]" />;
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

function GridIcon(): React.ReactElement {
  return <Icon icon={LayoutGrid} size={14} />;
}

function ListIcon(): React.ReactElement {
  return <Icon icon={List} size={14} />;
}

export default ConnectionsView;
