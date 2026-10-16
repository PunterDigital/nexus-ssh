import React, { useCallback, useRef } from 'react';
import type { VaultTreeNode } from '../../../shared/types';
import { ChevronRight, Folder, LockKeyhole, Monitor } from 'lucide-react';
import { Icon } from '../common/Icon';

// ============================================================
// TreeNode — recursive tree node for vault/group/host items
// ============================================================

interface TreeNodeProps {
  node: VaultTreeNode;
  depth: number;
  expanded: boolean;
  selected: boolean;
  connected: boolean;
  onToggle: (nodeId: string) => void;
  onSelect: (node: VaultTreeNode) => void;
  onConnect: (node: VaultTreeNode) => void;
  onContextMenu: (e: React.MouseEvent, node: VaultTreeNode) => void;
  onDragStart: (e: React.DragEvent, node: VaultTreeNode) => void;
  onDragOver: (e: React.DragEvent, node: VaultTreeNode) => void;
  onDrop: (e: React.DragEvent, node: VaultTreeNode) => void;
  expandedNodes: Set<string>;
  selectedNodeId: string | null;
  connectedHostIds: Set<string>;
  filterText: string;
}

/** Lucide icons for each node type. */
const VaultIcon: React.FC = () => (
  <Icon icon={LockKeyhole} size={14} />
);

const GroupIcon: React.FC = () => (
  <Icon icon={Folder} size={14} />
);

const HostIcon: React.FC = () => (
  <Icon icon={Monitor} size={14} />
);

const ChevronIcon: React.FC<{ expanded: boolean }> = ({ expanded }) => (
  <Icon
    icon={ChevronRight}
    size={10}
    className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
  />
);

function getNodeIcon(type: VaultTreeNode['type']): React.ReactNode {
  switch (type) {
    case 'vault':
      return <VaultIcon />;
    case 'group':
      return <GroupIcon />;
    case 'host':
      return <HostIcon />;
  }
}

export const TreeNode: React.FC<TreeNodeProps> = ({
  node,
  depth,
  expanded,
  selected,
  connected,
  onToggle,
  onSelect,
  onConnect,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  expandedNodes,
  selectedNodeId,
  connectedHostIds,
  filterText,
}) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  const hasChildren = node.children && node.children.length > 0;
  const isExpandable = node.type !== 'host';
  const paddingLeft = 8 + depth * 16;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isExpandable) {
        onToggle(node.id);
      }
      onSelect(node);
    },
    [node, isExpandable, onToggle, onSelect],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (node.type === 'host') {
        onConnect(node);
      }
    },
    [node, onConnect],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e, node);
    },
    [node, onContextMenu],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      onDragStart(e, node);
    },
    [node, onDragStart],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      onDragOver(e, node);
    },
    [node, onDragOver],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      onDrop(e, node);
    },
    [node, onDrop],
  );

  return (
    <div>
      <div
        ref={nodeRef}
        className={`tree-node group no-select ${selected ? 'active' : ''} ${
          selected ? 'border-l-2 border-l-[var(--color-accent)]' : 'border-l-2 border-l-transparent'
        }`}
        style={{ paddingLeft }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Expand/collapse chevron */}
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          {isExpandable ? (
            <ChevronIcon expanded={expanded} />
          ) : (
            <span className="w-4" />
          )}
        </span>

        {/* Node icon */}
        <span className="flex shrink-0 items-center text-[var(--color-text-muted)]">
          {getNodeIcon(node.type)}
        </span>

        {/* Label */}
        <span className="min-w-0 flex-1 truncate">{node.label}</span>

        {/* Host colour indicator */}
        {node.type === 'host' && node.colour && (
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: node.colour }}
            title={`Colour: ${node.colour}`}
          />
        )}

        {/* Connection status indicator */}
        {node.type === 'host' && connected && (
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--color-success)]"
            title="Connected"
          />
        )}
      </div>

      {/* Render children if expanded */}
      {isExpandable && expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expandedNodes.has(child.id)}
              selected={selectedNodeId === child.id}
              connected={connectedHostIds.has(child.id)}
              onToggle={onToggle}
              onSelect={onSelect}
              onConnect={onConnect}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              expandedNodes={expandedNodes}
              selectedNodeId={selectedNodeId}
              connectedHostIds={connectedHostIds}
              filterText={filterText}
            />
          ))}
        </div>
      )}
    </div>
  );
};
