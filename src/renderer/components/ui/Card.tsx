import type React from 'react';
import { cx } from './cx';

const PADDING = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-6' } as const;

export interface CardProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Buttons on the right of the header. */
  actions?: React.ReactNode;
  padding?: keyof typeof PADDING;
  /** Renders a <section> with the title as its heading (default) or a plain <div>. */
  as?: 'section' | 'div';
}

/** A raised container for a group of related content (a settings group, a host). */
export function Card({ title, description, actions, padding = 'md', as = 'section', className, children, ...rest }: CardProps) {
  const Tag = as;
  return (
    <Tag className={cx('rounded-lg border border-line bg-surface-raised shadow-raised', PADDING[padding], className)} {...rest}>
      {(title || actions) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="truncate text-body-lg font-semibold text-fg">{title}</h3>}
            {description && <p className="mt-0.5 text-body-sm text-fg-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      {children}
    </Tag>
  );
}
