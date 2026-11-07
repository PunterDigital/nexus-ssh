import React, { useEffect, useState } from 'react';
import { RotateCw, X } from 'lucide-react';
import { Button, Dialog } from '../ui';
import { useTerminalStore } from '../../stores/terminal-store';
import type { ReconnectState } from '../../lib/reconnect';

// ============================================================
// ReconnectDialog — a terminal's connection was lost (#4322)
//
// Shows the reconnect loop of the active tab's session: the countdown to the next attempt,
// the attempt under way, or that it gave up. The loop itself lives in terminal-store, so it
// keeps going while another view is open. Closing the dialog stops retrying; the tab keeps
// its output.
// ============================================================

export interface ReconnectDialogProps {
  sessionId: string;
  tabId: string;
  label: string;
  state: ReconnectState;
}

/** Whole seconds left until `retryAt`, ticking while the countdown runs. */
function useSecondsLeft(retryAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (retryAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [retryAt]);
  return retryAt === null ? 0 : Math.max(0, Math.ceil((retryAt - now) / 1000));
}

function statusText(state: ReconnectState, secondsLeft: number): string {
  switch (state.phase) {
    case 'waiting':
      return `Reconnecting in ${secondsLeft} s (attempt ${state.attempt} of ${state.total})…`;
    case 'connecting':
      return `Reconnecting (attempt ${state.attempt} of ${state.total})…`;
    case 'failed':
      return `Couldn’t reconnect after ${state.total} attempts.`;
    case 'stopped':
      return 'Stopped reconnecting.';
  }
}

export function ReconnectDialog({ sessionId, tabId, label, state }: ReconnectDialogProps): React.ReactElement {
  const reconnectNow = useTerminalStore((s) => s.reconnectNow);
  const stopReconnect = useTerminalStore((s) => s.stopReconnect);
  const retryReconnect = useTerminalStore((s) => s.retryReconnect);
  const dismissReconnect = useTerminalStore((s) => s.dismissReconnect);
  const removeTab = useTerminalStore((s) => s.removeTab);

  const secondsLeft = useSecondsLeft(state.phase === 'waiting' ? state.retryAt : null);
  const retrying = state.phase === 'waiting' || state.phase === 'connecting';

  return (
    <Dialog
      open
      size="sm"
      dismissOnBackdrop={false}
      onClose={() => dismissReconnect(sessionId)}
      title="Connection closed"
      description={`The connection to ${label} was lost.`}
      footer={
        retrying ? (
          <>
            <Button variant="ghost" onClick={() => stopReconnect(sessionId)}>
              Stop retrying
            </Button>
            <Button
              variant="primary"
              icon={RotateCw}
              loading={state.phase === 'connecting'}
              disabled={state.phase !== 'waiting'}
              onClick={() => reconnectNow(sessionId)}
            >
              Reconnect now
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" icon={X} onClick={() => removeTab(tabId)}>
              Close tab
            </Button>
            <Button variant="primary" icon={RotateCw} onClick={() => retryReconnect(sessionId)}>
              Try again
            </Button>
          </>
        )
      }
    >
      <p role="status" className="text-body text-fg">
        {statusText(state, secondsLeft)}
      </p>
      <p className="mt-2 text-body text-fg-muted">Reason: {state.error}</p>
    </Dialog>
  );
}

export default ReconnectDialog;
