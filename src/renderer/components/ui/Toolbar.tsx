import type React from 'react';
import { cx, FOCUSABLE } from './cx';

export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Accessible name (e.g. "Remote files"). */
  label: string;
}

/**
 * A row of related controls (usually IconButtons). Left/Right arrow keys move focus between them,
 * as screen-reader users expect from role="toolbar"; Tab still reaches each one.
 */
export function Toolbar({ label, className, onKeyDown, children, ...rest }: ToolbarProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const target = e.target as HTMLElement;
    if (target.matches('input, textarea, select')) return; // let text fields move their caret
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const i = items.indexOf(target);
    if (i < 0) return;
    e.preventDefault();
    items[(i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length].focus();
  };
  return (
    <div
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
      className={cx('flex items-center gap-1', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

/** A thin vertical divider between groups in a Toolbar. */
export function ToolbarSeparator() {
  return <div role="separator" aria-orientation="vertical" className="mx-1 h-4 w-px bg-line" />;
}
