import React from 'react';
import { createPortal } from 'react-dom';
import { useUIStore, type NotificationItem } from '../../stores/ui-store';

// ============================================================
// ToastHost — renders the ui-store notifications (addNotification) as toasts
// ============================================================

const TYPE_COLOUR: Record<NotificationItem['type'], string> = {
  info: 'var(--color-accent)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-danger)',
};

export const ToastHost: React.FC = () => {
  const notifications = useUIStore((s) => s.notifications);
  const removeNotification = useUIStore((s) => s.removeNotification);

  // Portal + z-[150]: above dialogs (z-50) so a dialog's own feedback shows, but below the
  // host-key prompt (z-[200]). The column ignores clicks; only the toasts take them.
  return createPortal(
    <div className="pointer-events-none fixed bottom-10 right-4 z-[150] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
      {notifications.map((n) => (
        <div
          key={n.id}
          // Errors interrupt screen readers; everything else waits its turn.
          role={n.type === 'error' ? 'alert' : 'status'}
          className="toast pointer-events-auto w-full"
          style={{ borderLeft: `3px solid ${TYPE_COLOUR[n.type]}` }}
          data-type={n.type}
        >
          <span className="min-w-0 flex-1 break-words">{n.message}</span>
          <button
            type="button"
            className="btn-ghost flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-base leading-none"
            style={{ color: 'var(--color-text-muted)' }}
            aria-label="Dismiss notification"
            onClick={() => removeNotification(n.id)}
          >
            &times;
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
};
