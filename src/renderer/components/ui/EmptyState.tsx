import type React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../common/Icon';
import { cx } from './cx';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  /** Usually one primary Button that fixes the emptiness ("New Host"). */
  action?: React.ReactNode;
  className?: string;
}

/** What a view shows when it has nothing in it: say why, and offer the next step. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-center justify-center gap-3 p-8 text-center', className)}>
      <div className="flex size-12 items-center justify-center rounded-xl bg-surface-raised text-fg-muted">
        <Icon icon={icon} size={24} strokeWidth={1.75} />
      </div>
      <div className="flex max-w-sm flex-col gap-1">
        <h3 className="text-body-lg font-semibold text-fg">{title}</h3>
        {description && <p className="text-body-sm text-fg-muted">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
