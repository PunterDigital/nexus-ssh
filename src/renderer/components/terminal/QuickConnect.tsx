import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTerminalStore } from '../../stores/terminal-store';

// ============================================================
// QuickConnect — dropdown for fast user@host:port connections
// ============================================================

interface QuickConnectProps {
  open: boolean;
  onClose: () => void;
}

interface ParsedConnection {
  username: string;
  hostname: string;
  port: number;
}

function parseConnectionString(input: string): ParsedConnection | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let username = '';
  let hostname = '';
  let port = 22;

  // Format: user@host:port, user@host, host:port, or just host
  let rest = trimmed;

  const atIndex = rest.indexOf('@');
  if (atIndex !== -1) {
    username = rest.substring(0, atIndex);
    rest = rest.substring(atIndex + 1);
  }

  // Check for IPv6 bracket notation [host]:port
  if (rest.startsWith('[')) {
    const closeBracket = rest.indexOf(']');
    if (closeBracket !== -1) {
      hostname = rest.substring(1, closeBracket);
      const afterBracket = rest.substring(closeBracket + 1);
      if (afterBracket.startsWith(':')) {
        const parsed = parseInt(afterBracket.substring(1), 10);
        if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) {
          port = parsed;
        }
      }
    } else {
      return null;
    }
  } else {
    // Standard host:port
    const colonIndex = rest.lastIndexOf(':');
    if (colonIndex !== -1) {
      const possiblePort = parseInt(rest.substring(colonIndex + 1), 10);
      if (!isNaN(possiblePort) && possiblePort > 0 && possiblePort <= 65535) {
        hostname = rest.substring(0, colonIndex);
        port = possiblePort;
      } else {
        hostname = rest;
      }
    } else {
      hostname = rest;
    }
  }

  if (!hostname) return null;

  return { username: username || 'root', hostname, port };
}

export const QuickConnect: React.FC<QuickConnectProps> = ({ open, onClose }) => {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const connectSession = useTerminalStore((s) => s.connectSession);
  const setActiveTab = useTerminalStore((s) => s.setActiveTab);

  // Focus input when opening
  useEffect(() => {
    if (open) {
      setInput('');
      setError(null);
      setConnecting(false);
      // Delay focus so the element is visible
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;

    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, onClose]);

  const handleConnect = useCallback(async () => {
    const parsed = parseConnectionString(input);
    if (!parsed) {
      setError('Invalid format. Use user@host:port');
      return;
    }

    setError(null);
    setConnecting(true);

    try {
      // For quick connect, we create a temporary host entry via the backend.
      // The connectSession call expects a hostId. We use a special
      // convention: pass a serialized quick-connect descriptor.
      // The backend should handle hostId starting with "quick:" specially.
      const quickId = `quick:${parsed.username}@${parsed.hostname}:${parsed.port}`;

      const sessionId = await connectSession(quickId);

      // The store already creates a tab, but update label for clarity
      const tabs = useTerminalStore.getState().tabs;
      const tab = tabs.find((t) => t.sessionId === sessionId);
      if (tab) {
        useTerminalStore.getState().updateTab(tab.id, {
          label: `${parsed.username}@${parsed.hostname}`,
        });
        setActiveTab(tab.id);
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      setConnecting(false);
    }
  }, [input, connectSession, setActiveTab, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !connecting) {
        e.preventDefault();
        handleConnect();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [handleConnect, connecting, onClose]
  );

  if (!open) return null;

  const parsed = parseConnectionString(input);

  return (
    <div
      ref={panelRef}
      className="absolute right-2 top-1 z-50 w-80 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4 shadow-2xl"
    >
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        Quick Connect
      </div>

      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setError(null);
        }}
        onKeyDown={handleKeyDown}
        placeholder="user@hostname:port"
        disabled={connecting}
        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
        autoComplete="off"
        spellCheck={false}
      />

      {/* Parsed preview */}
      {parsed && input.trim() && (
        <div className="mt-2 flex gap-3 text-[10px] text-[var(--color-text-muted)]">
          <span>
            User: <span className="text-[var(--color-text-secondary)]">{parsed.username}</span>
          </span>
          <span>
            Host: <span className="text-[var(--color-text-secondary)]">{parsed.hostname}</span>
          </span>
          <span>
            Port: <span className="text-[var(--color-text-secondary)]">{parsed.port}</span>
          </span>
        </div>
      )}

      {error && (
        <div className="mt-2 text-xs text-[var(--color-danger)]">{error}</div>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          disabled={connecting}
          className="rounded px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleConnect}
          disabled={connecting || !parsed}
          className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {connecting ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </div>
  );
};
