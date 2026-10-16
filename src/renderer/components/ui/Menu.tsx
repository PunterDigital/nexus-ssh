import React, { useEffect, useId, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../common/Icon';
import { cx } from './cx';

export type MenuEntry =
  | {
      id: string;
      label: string;
      icon?: LucideIcon;
      /** Keyboard hint shown on the right, e.g. "Ctrl+T". Display only. */
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { separator: true; id: string };

export interface MenuProps {
  /** Renders the trigger. Spread `props` onto a Button or IconButton. */
  trigger: (props: {
    ref: React.Ref<HTMLButtonElement>;
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    'aria-controls': string;
    onClick: () => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
  }) => React.ReactNode;
  items: MenuEntry[];
  /** Which edge of the trigger the menu lines up with. */
  align?: 'start' | 'end';
  /** Accessible name of the menu, if the trigger has no visible text. */
  label?: string;
  /** Classes for the wrapper, e.g. `flex min-w-0 flex-1` to let a full-width trigger fill a row. */
  className?: string;
}

/**
 * Dropdown menu (WAI-ARIA menu button). Enter / Space / ArrowDown open it on the first item,
 * ArrowUp on the last; arrows, Home and End move; Enter selects; Escape closes and returns
 * focus to the trigger; Tab or a click outside closes it.
 */
export function Menu({ trigger, items, align = 'start', label, className }: MenuProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusOn = useRef<'first' | 'last'>('first');

  const menuItems = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];

  useEffect(() => {
    if (!open) return;
    const all = menuItems();
    (focusOn.current === 'first' ? all[0] : all[all.length - 1])?.focus();
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusOn.current = e.key === 'ArrowDown' ? 'first' : 'last';
      setOpen(true);
    }
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const all = menuItems();
    const i = all.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => all[(n + all.length) % all.length]?.focus();
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); go(i + 1); break;
      case 'ArrowUp': e.preventDefault(); go(i - 1); break;
      case 'Home': e.preventDefault(); go(0); break;
      case 'End': e.preventDefault(); go(all.length - 1); break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); close(true); break;
      case 'Tab': close(false); break;
    }
  };

  return (
    <div className={cx('relative', className ?? 'inline-flex')}>
      {trigger({
        ref: triggerRef,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': `${id}-menu`,
        onClick: () => {
          focusOn.current = 'first';
          setOpen((o) => !o);
        },
        onKeyDown: onTriggerKeyDown,
      })}
      {open && (
        <div
          ref={menuRef}
          id={`${id}-menu`}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cx(
            'absolute top-full z-(--z-dropdown) mt-1 flex max-h-80 min-w-48 flex-col overflow-y-auto rounded-lg border border-line bg-surface-raised p-1 shadow-popover animate-fade-in',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item) =>
            'separator' in item ? (
              <div key={item.id} role="separator" className="my-1 h-px bg-line" />
            ) : (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                // Pointer and keyboard share one highlight: hovering an item focuses it.
                onMouseEnter={(e) => e.currentTarget.focus()}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
                className={cx(
                  'flex h-8 w-full shrink-0 items-center gap-2 rounded-md px-2 text-left text-body focus-ring-inset',
                  'focus:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50',
                  item.danger ? 'text-danger' : 'text-fg',
                )}
              >
                {item.icon ? <Icon icon={item.icon} size={14} /> : <span className="size-3.5" aria-hidden="true" />}
                <span className="flex-1 truncate">{item.label}</span>
                {item.shortcut && <kbd className="font-ui text-caption text-fg-muted">{item.shortcut}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
