import React from 'react';
import { SquareTerminal } from 'lucide-react';
import { Icon } from '../common/Icon';
import { cx } from '../ui';

// ============================================================
// Lock-screen building blocks shared by LockScreen and CreateVaultDialog (#2366)
// ============================================================

/** Full-window backdrop that centres its content and scrolls when the window is too short. */
export function LockLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="h-screen w-screen overflow-y-auto bg-surface-sunken font-ui text-fg">
      <div className="flex min-h-full items-center justify-center p-6">{children}</div>
    </div>
  );
}

/** The raised panel the lock-screen forms sit in. */
export function LockCard({
  children,
  className,
  size = 'sm',
}: {
  children: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md';
}): React.ReactElement {
  return (
    <div
      className={cx(
        'flex w-full flex-col gap-6 rounded-xl border border-line bg-surface p-8 shadow-dialog animate-fade-in',
        size === 'sm' ? 'max-w-sm' : 'max-w-md',
        className
      )}
    >
      {children}
    </div>
  );
}

export function NexusLogo({ size = 'md' }: { size?: 'md' | 'lg' }): React.ReactElement {
  return (
    <div
      className={cx(
        'flex shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent',
        size === 'lg' ? 'size-16' : 'size-12'
      )}
    >
      <Icon icon={SquareTerminal} size={size === 'lg' ? 32 : 24} strokeWidth={1.5} />
    </div>
  );
}

/** Error from the vault store, announced when it appears. */
export function UnlockError({
  message,
}: {
  message: string | null | undefined;
}): React.ReactElement | null {
  if (!message) return null;
  return (
    <div
      aria-live="assertive"
      className="rounded-md bg-danger-soft px-3 py-2 text-body-sm text-danger"
    >
      {message}
    </div>
  );
}
