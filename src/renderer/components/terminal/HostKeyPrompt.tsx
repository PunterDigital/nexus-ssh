import React from 'react';
import type { HostKeyPrompt as HostKeyPromptData, HostKeyVerification } from '../../../shared/types';

// ============================================================
// HostKeyPrompt — TOFU host key verification modal
// ============================================================

interface HostKeyPromptProps {
  prompt: HostKeyPromptData;
  onRespond: (response: HostKeyVerification) => void;
}

export const HostKeyPrompt: React.FC<HostKeyPromptProps> = ({
  prompt,
  onRespond,
}) => {
  const isChanged = prompt.status === 'changed';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] shadow-2xl">
        {/* Header */}
        <div
          className={`flex items-center gap-2 rounded-t-lg border-b px-5 py-3 ${
            isChanged
              ? 'border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10'
              : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)]'
          }`}
        >
          {/* Warning icon */}
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke={isChanged ? 'var(--color-danger)' : 'var(--color-warning)'}
            strokeWidth="1.5"
          >
            <path d="M10 2L1 18h18L10 2z" />
            <line x1="10" y1="8" x2="10" y2="12" />
            <line x1="10" y1="15" x2="10.01" y2="15" />
          </svg>
          <span
            className={`text-sm font-semibold ${
              isChanged
                ? 'text-[var(--color-danger)]'
                : 'text-[var(--color-warning)]'
            }`}
          >
            {isChanged ? 'WARNING: Host Key Changed!' : 'Unknown Host Key'}
          </span>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {isChanged ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-[var(--color-danger)]">
                HOST IDENTIFICATION HAS CHANGED!
              </p>
              <p className="text-xs leading-relaxed text-[var(--color-text-primary)]">
                The host key for{' '}
                <span className="font-mono font-semibold">
                  {prompt.hostname}:{prompt.port}
                </span>{' '}
                has changed since the last connection. This could indicate a
                man-in-the-middle attack, or the server may have been reinstalled.
              </p>
              <div className="rounded border border-[var(--color-danger)]/20 bg-[var(--color-danger)]/5 px-3 py-2 text-xs text-[var(--color-danger)]">
                If you were not expecting this change, do NOT continue. Contact
                your system administrator.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-[var(--color-text-primary)]">
                The authenticity of host{' '}
                <span className="font-mono font-semibold">
                  {prompt.hostname}:{prompt.port}
                </span>{' '}
                can&apos;t be established.
              </p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Are you sure you want to continue connecting?
              </p>
            </div>
          )}

          {/* Fingerprint */}
          <div className="mt-4 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              {prompt.keyType} key fingerprint
            </div>
            <div className="mt-1 break-all font-mono text-xs text-[var(--color-text-primary)]">
              {prompt.fingerprint}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <button
            onClick={() => onRespond('reject')}
            className="rounded px-4 py-1.5 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
          >
            Reject
          </button>
          <button
            onClick={() => onRespond('accept')}
            className={`rounded px-4 py-1.5 text-xs font-medium transition-colors ${
              isChanged
                ? 'bg-[var(--color-danger)] text-white hover:opacity-90'
                : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] hover:bg-[var(--color-border)]'
            }`}
          >
            Accept Once
          </button>
          <button
            onClick={() => onRespond('always')}
            className={`rounded px-4 py-1.5 text-xs font-medium transition-colors ${
              isChanged
                ? 'bg-[var(--color-danger)] text-white hover:opacity-90'
                : 'bg-[var(--color-accent)] text-white hover:opacity-90'
            }`}
          >
            Always Accept
          </button>
        </div>
      </div>
    </div>
  );
};
