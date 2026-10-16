import React, { useId, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../common/Icon';
import { cx } from './cx';

export interface TabItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
  /** The panel shown while this tab is selected. */
  content: React.ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name of the tab list (e.g. "Settings sections"). */
  label: string;
  className?: string;
}

/**
 * WAI-ARIA tabs: one tab stop, arrow keys / Home / End move between tabs and select them.
 * For the app's top-level navigation between sessions, use the shell's tab bar, not this.
 */
export function Tabs({ items, value, onChange, label, className }: TabsProps) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const enabled = items.filter((t) => !t.disabled);
  const selected = items.find((t) => t.id === value) ?? enabled[0];

  const move = (e: React.KeyboardEvent) => {
    const i = enabled.findIndex((t) => t.id === selected?.id);
    const next =
      e.key === 'ArrowRight' ? enabled[(i + 1) % enabled.length]
      : e.key === 'ArrowLeft' ? enabled[(i - 1 + enabled.length) % enabled.length]
      : e.key === 'Home' ? enabled[0]
      : e.key === 'End' ? enabled[enabled.length - 1]
      : null;
    if (!next) return;
    e.preventDefault();
    onChange(next.id);
    listRef.current?.querySelector<HTMLElement>(`[data-tab-id="${next.id}"]`)?.focus();
  };

  return (
    <div className={cx('flex min-h-0 flex-col', className)}>
      <div ref={listRef} role="tablist" aria-label={label} onKeyDown={move} className="flex shrink-0 gap-1 border-b border-line">
        {items.map((t) => {
          const isSelected = t.id === selected?.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${id}-tab-${t.id}`}
              data-tab-id={t.id}
              aria-selected={isSelected}
              aria-controls={`${id}-panel-${t.id}`}
              tabIndex={isSelected ? 0 : -1}
              disabled={t.disabled}
              onClick={() => onChange(t.id)}
              className={cx(
                '-mb-px inline-flex h-8 items-center gap-1.5 border-b-2 px-3 text-body font-medium focus-ring-inset',
                'transition-colors duration-(--duration-fast) ease-standard disabled:cursor-not-allowed disabled:opacity-50',
                isSelected ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {t.icon && <Icon icon={t.icon} size={14} />}
              {t.label}
            </button>
          );
        })}
      </div>
      {selected && (
        <div
          role="tabpanel"
          id={`${id}-panel-${selected.id}`}
          aria-labelledby={`${id}-tab-${selected.id}`}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-auto pt-4 focus-ring-inset"
        >
          {selected.content}
        </div>
      )}
    </div>
  );
}
