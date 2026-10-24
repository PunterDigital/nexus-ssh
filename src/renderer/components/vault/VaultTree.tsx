import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useVaultStore, useTerminalStore, useUIStore } from '../../stores';
import type { VaultTreeNode } from '../../../shared/types';
import type { Vault, Group, Host } from '../../../shared/types';
import { TreeNode } from './TreeNode';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuEntry } from './ContextMenu';
import { Copy, Folder, Pencil, Plus, Terminal, Trash2 } from 'lucide-react';
import { Icon } from '../common/Icon';

// ============================================================
// VaultTree — hierarchical vault > group > host tree
// ============================================================

interface VaultTreeProps {
  filterText: string;
}

/** Build VaultTreeNode hierarchy from flat vault, group, host arrays. */
function buildTree(
  vaults: Vault[],
  groups: Group[],
  hosts: Host[],
): VaultTreeNode[] {
  return vaults
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((vault): VaultTreeNode => {
      const vaultGroups = groups.filter((g) => g.vault_id === vault.id);
      const vaultHosts = hosts.filter((h) => h.vault_id === vault.id);

      function buildGroupNode(group: Group): VaultTreeNode {
        const childGroups = vaultGroups
          .filter((g) => g.parent_id === group.id)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(buildGroupNode);

        const childHosts = vaultHosts
          .filter((h) => h.group_id === group.id)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(
            (h): VaultTreeNode => ({
              type: 'host',
              id: h.id,
              label: h.label,
              colour: h.colour ?? undefined,
              vaultId: vault.id,
              parentId: group.id,
            }),
          );

        return {
          type: 'group',
          id: group.id,
          label: group.name,
          icon: group.icon ?? undefined,
          vaultId: vault.id,
          parentId: group.parent_id ?? vault.id,
          children: [...childGroups, ...childHosts],
        };
      }

      // Top-level groups (no parent)
      const topGroups = vaultGroups
        .filter((g) => g.parent_id === null)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(buildGroupNode);

      // Ungrouped hosts
      const ungroupedHosts = vaultHosts
        .filter((h) => h.group_id === null)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(
          (h): VaultTreeNode => ({
            type: 'host',
            id: h.id,
            label: h.label,
            colour: h.colour ?? undefined,
            vaultId: vault.id,
            parentId: vault.id,
          }),
        );

      // If there are ungrouped hosts, wrap them in an "Ungrouped" virtual group
      const ungroupedNode: VaultTreeNode[] =
        ungroupedHosts.length > 0
          ? [
              {
                type: 'group',
                id: `ungrouped-${vault.id}`,
                label: 'Ungrouped',
                vaultId: vault.id,
                parentId: vault.id,
                children: ungroupedHosts,
              },
            ]
          : [];

      return {
        type: 'vault',
        id: vault.id,
        label: vault.name,
        icon: vault.icon ?? undefined,
        vaultId: vault.id,
        children: [...topGroups, ...ungroupedNode],
      };
    });
}

/** Filter tree to only include nodes matching the search text. */
function filterTree(
  nodes: VaultTreeNode[],
  text: string,
): VaultTreeNode[] {
  const lower = text.toLowerCase();

  function prune(node: VaultTreeNode): VaultTreeNode | null {
    if (node.type === 'host') {
      return node.label.toLowerCase().includes(lower) ? node : null;
    }

    const filteredChildren = node.children
      ?.map(prune)
      .filter((n): n is VaultTreeNode => n !== null);

    if (node.label.toLowerCase().includes(lower) || (filteredChildren && filteredChildren.length > 0)) {
      return { ...node, children: filteredChildren };
    }

    return null;
  }

  return nodes.map(prune).filter((n): n is VaultTreeNode => n !== null);
}

/** Collect all node IDs from a tree (used to expand all when filtering). */
function collectNodeIds(nodes: VaultTreeNode[]): string[] {
  const ids: string[] = [];
  function walk(n: VaultTreeNode) {
    ids.push(n.id);
    n.children?.forEach(walk);
  }
  nodes.forEach(walk);
  return ids;
}

export const VaultTree: React.FC<VaultTreeProps> = ({ filterText }) => {
  const vaults = useVaultStore((s) => s.vaults);
  const groups = useVaultStore((s) => s.groups);
  const hosts = useVaultStore((s) => s.hosts);
  const setSelectedHostId = useVaultStore((s) => s.setSelectedHostId);
  const setSelectedGroupId = useVaultStore((s) => s.setSelectedGroupId);
  const setSelectedVaultId = useVaultStore((s) => s.setSelectedVaultId);
  const deleteHost = useVaultStore((s) => s.deleteHost);
  const deleteGroup = useVaultStore((s) => s.deleteGroup);
  const sessions = useTerminalStore((s) => s.sessions);
  const connectSession = useTerminalStore((s) => s.connectSession);
  const showModal = useUIStore((s) => s.showModal);
  const setView = useUIStore((s) => s.setView);

  // Local expanded state
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: VaultTreeNode;
  } | null>(null);

  // Drag state
  const dragNodeRef = useRef<VaultTreeNode | null>(null);

  // Connected host IDs
  const connectedHostIds = useMemo(
    () => new Set(sessions.filter((s) => s.connected).map((s) => s.hostId)),
    [sessions],
  );

  // Build and optionally filter the tree
  const fullTree = useMemo(() => buildTree(vaults, groups, hosts), [vaults, groups, hosts]);

  const displayTree = useMemo(() => {
    if (!filterText.trim()) return fullTree;
    return filterTree(fullTree, filterText.trim());
  }, [fullTree, filterText]);

  // When filtering, expand all nodes so matches are visible
  const effectiveExpanded = useMemo(() => {
    if (!filterText.trim()) return expandedNodes;
    const allIds = collectNodeIds(displayTree);
    return new Set(allIds);
  }, [filterText, expandedNodes, displayTree]);

  // Handlers
  const handleToggle = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (node: VaultTreeNode) => {
      setSelectedNodeId(node.id);
      if (node.type === 'host') {
        setSelectedHostId(node.id);
        setSelectedGroupId(null);
        setSelectedVaultId(null);
      } else if (node.type === 'group') {
        setSelectedHostId(null);
        setSelectedGroupId(node.id);
        setSelectedVaultId(null);
      } else {
        setSelectedHostId(null);
        setSelectedGroupId(null);
        setSelectedVaultId(node.id);
      }
    },
    [setSelectedHostId, setSelectedGroupId, setSelectedVaultId],
  );

  const handleConnect = useCallback(
    (node: VaultTreeNode) => {
      if (node.type === 'host') {
        connectSession(node.id);
        setView('terminal');
      }
    },
    [connectSession, setView],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, node: VaultTreeNode) => {
      setContextMenu({ x: e.clientX, y: e.clientY, node });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Drag and drop handlers
  const handleDragStart = useCallback(
    (e: React.DragEvent, node: VaultTreeNode) => {
      dragNodeRef.current = node;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.id);
    },
    [],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, _node: VaultTreeNode) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, targetNode: VaultTreeNode) => {
      e.preventDefault();
      const dragNode = dragNodeRef.current;
      if (!dragNode) return;
      if (dragNode.id === targetNode.id) return;

      // Only allow reordering within the same parent/level
      if (dragNode.parentId !== targetNode.parentId) return;
      if (dragNode.type !== targetNode.type) return;

      // Swap sort orders via store updates
      const sourceId = dragNode.id;
      const targetId = targetNode.id;

      if (dragNode.type === 'host') {
        const sourceHost = hosts.find((h) => h.id === sourceId);
        const targetHost = hosts.find((h) => h.id === targetId);
        if (sourceHost && targetHost) {
          const { updateHost } = useVaultStore.getState();
          updateHost(sourceId, { sort_order: targetHost.sort_order });
          updateHost(targetId, { sort_order: sourceHost.sort_order });
        }
      } else if (dragNode.type === 'group') {
        const sourceGroup = groups.find((g) => g.id === sourceId);
        const targetGroup = groups.find((g) => g.id === targetId);
        if (sourceGroup && targetGroup) {
          const { updateGroup } = useVaultStore.getState();
          updateGroup(sourceId, { sort_order: targetGroup.sort_order });
          updateGroup(targetId, { sort_order: sourceGroup.sort_order });
        }
      }

      dragNodeRef.current = null;
    },
    [hosts, groups],
  );

  // Build context menu items based on node type
  const contextMenuItems = useMemo((): ContextMenuEntry[] => {
    if (!contextMenu) return [];
    const { node } = contextMenu;

    const iconPlus = <Icon icon={Plus} size={12} />;
    const iconEdit = <Icon icon={Pencil} size={12} />;
    const iconTrash = <Icon icon={Trash2} size={12} />;
    const iconConnect = <Icon icon={Terminal} size={12} />;
    const iconCopy = <Icon icon={Copy} size={12} />;
    const iconFolder = <Icon icon={Folder} size={12} />;

    switch (node.type) {
      case 'vault':
        return [
          {
            label: 'New Group',
            icon: iconPlus,
            onClick: () =>
              showModal('new-group', { vaultId: node.id, parentId: null }),
          },
          {
            label: 'New Host',
            icon: iconPlus,
            onClick: () =>
              showModal('new-host', { vaultId: node.id, groupId: null }),
          },
          { type: 'divider' },
          {
            label: 'Edit Vault',
            icon: iconEdit,
            onClick: () => showModal('edit-vault', { vaultId: node.id }),
          },
          {
            label: 'Delete Vault',
            icon: iconTrash,
            onClick: () => showModal('delete-vault', { vaultId: node.id }),
            danger: true,
          },
        ];

      case 'group':
        return [
          {
            label: 'New Sub-group',
            icon: iconFolder,
            onClick: () =>
              showModal('new-group', {
                vaultId: node.vaultId,
                parentId: node.id,
              }),
          },
          {
            label: 'New Host',
            icon: iconPlus,
            onClick: () =>
              showModal('new-host', {
                vaultId: node.vaultId,
                groupId: node.id,
              }),
          },
          { type: 'divider' },
          {
            label: 'Edit Group',
            icon: iconEdit,
            onClick: () =>
              showModal('edit-group', { groupId: node.id }),
          },
          {
            label: 'Delete Group',
            icon: iconTrash,
            onClick: () => deleteGroup(node.id),
            danger: true,
          },
        ];

      case 'host': {
        const host = hosts.find((h) => h.id === node.id);
        return [
          {
            label: 'Connect',
            icon: iconConnect,
            onClick: () => handleConnect(node),
          },
          {
            label: 'Open SFTP',
            icon: iconFolder,
            onClick: () => {
              handleConnect(node);
              setView('sftp');
            },
          },
          { type: 'divider' },
          {
            label: 'Edit Host',
            icon: iconEdit,
            onClick: () => showModal('edit-host', { hostId: node.id }),
          },
          {
            label: 'Copy Hostname',
            icon: iconCopy,
            onClick: () => {
              if (host) {
                navigator.clipboard.writeText(host.hostname);
              }
            },
          },
          { type: 'divider' },
          {
            label: 'Delete Host',
            icon: iconTrash,
            onClick: () => deleteHost(node.id),
            danger: true,
          },
        ];
      }

      default:
        return [];
    }
  }, [contextMenu, showModal, handleConnect, deleteHost, deleteGroup, hosts, setView]);

  // Empty state
  if (displayTree.length === 0) {
    if (filterText.trim()) {
      return (
        <div className="rounded px-2 py-4 text-center text-xs text-[var(--color-text-muted)]">
          No matches for &ldquo;{filterText}&rdquo;
        </div>
      );
    }

    return (
      <div className="rounded px-2 py-4 text-center text-xs text-[var(--color-text-muted)]">
        No connections yet.
        <br />
        Click + to add a host.
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-0.5">
        {displayTree.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            depth={0}
            expanded={effectiveExpanded.has(node.id)}
            selected={selectedNodeId === node.id}
            connected={connectedHostIds.has(node.id)}
            onToggle={handleToggle}
            onSelect={handleSelect}
            onConnect={handleConnect}
            onContextMenu={handleContextMenu}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            expandedNodes={effectiveExpanded}
            selectedNodeId={selectedNodeId}
            connectedHostIds={connectedHostIds}
            filterText={filterText}
          />
        ))}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={closeContextMenu}
        />
      )}
    </>
  );
};
