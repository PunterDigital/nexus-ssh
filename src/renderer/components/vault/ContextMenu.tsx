import React, { useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../ui';

// ============================================================
// ContextMenu — right-click menu at the pointer, rendered via portal. Looks and behaves like
// the design system's Menu (role="menu", arrows / Home / End move, Escape closes and returns
// focus), but opens where the user clicked instead of under a trigger button.
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
  /** Accessible name of the menu. */
  label?: string;
}

const EDGE = 4; // px kept between the menu and the window edge

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose, label }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const menuItems = () => [
    ...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []),
  ];

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        openerRef.current?.focus?.();
      }
    },
    [onClose],
  );

  const handlePointerDown = useCallback(
    (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [handleKeyDown, handlePointerDown]);

  // Keyboard users land on the first item, as in Menu.
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, []);

  // Open at the pointer, kept inside the window. The coordinates are runtime values, so they
  // are set on the element before paint rather than through a style prop.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    el.style.left = `${Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE))}px`;
    el.style.top = `${Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE))}px`;
  }, [x, y]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const all = menuItems();
    const i = all.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => all[(n + all.length) % all.length]?.focus();
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); go(i + 1); break;
      case 'ArrowUp': e.preventDefault(); go(i - 1); break;
      case 'Home': e.preventDefault(); go(0); break;
      case 'End': e.preventDefault(); go(all.length - 1); break;
      case 'Tab': e.preventDefault(); onClose(); break;
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      onKeyDown={onMenuKeyDown}
      className="fixed top-0 left-0 z-(--z-dropdown) flex max-h-80 min-w-40 flex-col overflow-y-auto rounded-lg border border-line bg-surface-raised p-1 shadow-popover animate-fade-in"
    >
      {items.map((entry, idx) => {
        if (isDivider(entry)) {
          return <div key={`div-${idx}`} role="separator" className="my-1 h-px shrink-0 bg-line" />;
        }

        return (
          <button
            key={`item-${idx}`}
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={entry.disabled}
            // Pointer and keyboard share one highlight: hovering an item focuses it.
            onMouseEnter={(e) => e.currentTarget.focus()}
            onClick={() => {
              if (!entry.disabled) {
                entry.onClick();
                onClose();
              }
            }}
            className={cx(
              'flex h-8 w-full shrink-0 items-center gap-2 rounded-md px-2 text-left text-body focus-ring-inset',
              'focus:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50',
              entry.danger ? 'text-danger' : 'text-fg',
            )}
          >
            {entry.icon && (
              <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                {entry.icon}
              </span>
            )}
            <span className="flex-1 truncate">{entry.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
};
