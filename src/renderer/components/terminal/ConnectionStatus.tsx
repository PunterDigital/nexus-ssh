import React from 'react';
import { CircleAlert } from 'lucide-react';
import { Icon } from '../common/Icon';

// ============================================================
// ConnectionStatus — overlay shown while connecting to a host
// ============================================================

export type ConnectionPhase =
  | 'connecting'
  | 'authenticating'
  | 'opening'
  | 'connected'
  | 'error';

interface ConnectionStatusProps {
  hostname: string;
  phase: ConnectionPhase;
  error?: string | null;
  onRetry?: () => void;
  onCancel?: () => void;
}

const phaseMessages: Record<ConnectionPhase, string> = {
  connecting: 'Connecting to',
  authenticating: 'Authenticating with',
  opening: 'Opening terminal on',
  connected: 'Connected to',
  error: 'Failed to connect to',
};

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({
  hostname,
  phase,
  error,
  onRetry,
  onCancel,
}) => {
  const isLoading = phase !== 'error' && phase !== 'connected';
  const isError = phase === 'error';

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--color-bg-primary)]/90 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-8 shadow-2xl">
        {/* Spinner */}
        {isLoading && (
          <div className="relative h-10 w-10">
            <div className="absolute inset-0 animate-spin rounded-full border-2 border-[var(--color-bg-tertiary)] border-t-[var(--color-accent)]" />
          </div>
        )}

        {/* Error icon */}
        {isError && (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-danger)]/10">
            <Icon icon={CircleAlert} size={24} color="var(--color-danger)" />
          </div>
        )}

        {/* Status message */}
        <div className="flex flex-col items-center gap-1">
          <span
            className={`text-sm font-medium ${
              isError
                ? 'text-[var(--color-danger)]'
                : 'text-[var(--color-text-primary)]'
            }`}
          >
            {phaseMessages[phase]} {hostname}...
          </span>

          {isLoading && (
            <span className="text-xs text-[var(--color-text-muted)]">
              {phase === 'connecting' && 'Establishing TCP connection'}
              {phase === 'authenticating' && 'Verifying credentials'}
              {phase === 'opening' && 'Requesting PTY allocation'}
            </span>
          )}
        </div>

        {/* Error details */}
        {isError && error && (
          <div className="max-w-sm rounded border border-[var(--color-danger)]/20 bg-[var(--color-danger)]/5 px-3 py-2 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}

        {/* Action buttons */}
        {(isError || isLoading) && (
          <div className="flex items-center gap-2">
            {onCancel && (
              <button
                onClick={onCancel}
                className="rounded px-4 py-1.5 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]"
              >
                Cancel
              </button>
            )}
            {isError && onRetry && (
              <button
                onClick={onRetry}
                className="rounded bg-[var(--color-accent)] px-4 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
