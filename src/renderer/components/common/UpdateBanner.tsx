import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useUpdateStore } from '../../stores/update-store';
import { useUIStore } from '../../stores/ui-store';

// ============================================================
// UpdateBanner — non-blocking "new version" card (bottom-left; toasts are bottom-right)
// Windows: shown once the update has downloaded → "Restart to update".
// macOS: shown when a newer release exists → "Download" opens the downloads page.
// ============================================================

export const UpdateBanner: React.FC = () => {
  const status = useUpdateStore((s) => s.status);
  const dismissedVersion = useUpdateStore((s) => s.dismissedVersion);
  const setStatus = useUpdateStore((s) => s.setStatus);
  const dismiss = useUpdateStore((s) => s.dismiss);
  const addNotification = useUIStore((s) => s.addNotification);

  useEffect(() => {
    window.nexus.updater
      .getStatus()
      .then(setStatus)
      .catch(() => {});
    return window.nexus.updater.onStatus(setStatus);
  }, [setStatus]);

  if (!status) return null;
  const ready = status.state === 'downloaded';
  const notify = status.state === 'available' && status.mode === 'notify';
  if ((!ready && !notify) || status.version === dismissedVersion) return null;
  const version = status.version;

  const act = async () => {
    try {
      if (ready) await window.nexus.updater.install();
      else await window.nexus.updater.openDownloads();
    } catch (err) {
      addNotification('error', (err as Error).message);
    }
  };

  return createPortal(
    <div
      role="region"
      aria-label="App update"
      className="toast fixed bottom-10 left-4 z-[140] w-[340px] max-w-[calc(100vw-2rem)]"
      // Inline: .toast's own flex row/centre rules sit outside Tailwind's layers and would win.
      style={{
        borderLeft: '3px solid var(--color-accent)',
        flexDirection: 'column',
        alignItems: 'stretch',
      }}
    >
      <span>
        {ready
          ? `Nexus v${version} is ready to install.`
          : `Nexus v${version} is available.`}
      </span>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost text-xs" onClick={() => dismiss(version)}>
          Later
        </button>
        <button type="button" className="btn btn-primary text-xs" onClick={act}>
          {ready ? 'Restart to update' : 'Download'}
        </button>
      </div>
    </div>,
    document.body,
  );
};
