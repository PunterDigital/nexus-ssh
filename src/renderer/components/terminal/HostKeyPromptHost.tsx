import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  HostKeyPrompt as HostKeyPromptData,
  HostKeyVerification,
} from '../../../shared/types';
import { HostKeyPrompt } from './HostKeyPrompt';

// ============================================================
// HostKeyPromptHost — shows the main process's host-key questions one at a time
// ============================================================

export const HostKeyPromptHost: React.FC = () => {
  const [queue, setQueue] = useState<HostKeyPromptData[]>([]);

  useEffect(() => {
    const offPrompt = window.nexus.ssh.onHostKeyPrompt((prompt) =>
      setQueue((q) => [...q, prompt])
    );
    // The connection gave up (timeout, network error) before anyone answered.
    const offDismiss = window.nexus.ssh.onHostKeyDismiss((id) =>
      setQueue((q) => q.filter((p) => p.id !== id))
    );
    return () => {
      offPrompt();
      offDismiss();
    };
  }, []);

  const current = queue[0];

  const respond = useCallback(
    (answer: HostKeyVerification) => {
      if (!current) return;
      setQueue((q) => q.filter((p) => p.id !== current.id));
      window.nexus.ssh.respondHostKey(current.id, answer).catch(() => {});
    },
    [current]
  );

  // Portal + z-[200]: it must sit above any open dialog (e.g. Test Connection in the host form).
  return current
    ? createPortal(<HostKeyPrompt prompt={current} onRespond={respond} />, document.body)
    : null;
};
