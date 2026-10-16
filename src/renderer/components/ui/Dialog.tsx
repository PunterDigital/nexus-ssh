import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import { cx, FOCUSABLE } from './cx';

const WIDTH = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  /** Buttons, right-aligned. Put the primary action last. */
  footer?: React.ReactNode;
  size?: keyof typeof WIDTH;
  /** Clicking the backdrop closes the dialog (default true). Turn off for forms with unsaved input. */
  dismissOnBackdrop?: boolean;
  children?: React.ReactNode;
}

/**
 * Modal dialog: focus moves into it and is trapped there, Escape closes it, and focus returns to
 * whatever opened it. Rendered in a portal above the app (z-dialog).
 */
export function Dialog({ open, onClose, title, description, footer, size = 'md', dismissOnBackdrop = true, children }: DialogProps) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Focus the first control in the body or footer; fall back to the panel itself.
    const first = panel?.querySelector<HTMLElement>(`[data-dialog-body] :is(${FOCUSABLE}), [data-dialog-footer] :is(${FOCUSABLE})`);
    (first ?? panel)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const [head, tail] = [items[0], items[items.length - 1]];
      if (e.shiftKey && (document.activeElement === head || document.activeElement === panel)) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-(--z-dialog) flex items-center justify-center bg-overlay p-4 animate-fade-in"
      onMouseDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
        tabIndex={-1}
        className={cx(
          'flex max-h-full w-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-dialog outline-none animate-slide-up',
          WIDTH[size],
        )}
      >
        <header className={cx('flex items-start gap-3 px-5 py-4', children ? 'border-b border-line' : undefined)}>
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-title`} className="text-heading-sm font-semibold text-fg">
              {title}
            </h2>
            {description && (
              <p id={`${id}-description`} className="mt-1 text-body text-fg-muted">
                {description}
              </p>
            )}
          </div>
          <IconButton icon={X} label="Close" size="sm" onClick={onClose} className="-mr-1" />
        </header>
        {children && (
          <div data-dialog-body className="flex-1 overflow-y-auto px-5 py-4 text-body text-fg">
            {children}
          </div>
        )}
        {footer && (
          <footer data-dialog-footer className="flex items-center justify-end gap-2 border-t border-line bg-surface-sunken px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
