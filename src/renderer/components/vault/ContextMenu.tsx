import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

// ============================================================
// ContextMenu — right-click menu rendered via portal
// ============================================================

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuDivider {
  type: 'divider';
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuDivider;

function isDivider(entry: ContextMenuEntry): entry is ContextMenuDivider {
  return 'type' in entry && entry.type === 'divider';
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [handleKeyDown, handleClickOutside]);

  // Adjust position to keep menu within viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (rect.right > vw) {
      menuRef.current.style.left = `${vw - rect.width - 4}px`;
    }
    if (rect.bottom > vh) {
      menuRef.current.style.top = `${vh - rect.height - 4}px`;
    }
  }, [x, y]);

  return createPortal(
    <div
      ref={menuRef}
      className="animate-fade-in fixed z-[100] min-w-[160px] rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] py-1 shadow-xl"
      style={{ left: x, top: y }}
    >
      {items.map((entry, idx) => {
        if (isDivider(entry)) {
          return (
            <div
              key={`div-${idx}`}
              className="my-1 h-px bg-[var(--color-border)]"
            />
          );
        }

        return (
          <button
            key={`item-${idx}`}
            onClick={() => {
              if (!entry.disabled) {
                entry.onClick();
                onClose();
              }
            }}
            disabled={entry.disabled}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
              entry.disabled
                ? 'cursor-not-allowed text-[var(--color-text-muted)] opacity-50'
                : entry.danger
                  ? 'text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {entry.icon && (
              <span className="flex h-4 w-4 items-center justify-center">
                {entry.icon}
              </span>
            )}
            <span>{entry.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
};
