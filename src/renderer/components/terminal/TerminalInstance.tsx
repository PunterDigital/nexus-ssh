import React, { useRef, useEffect, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import type { TerminalTheme } from '../../../shared/types';
import { DEFAULT_FONT, DEFAULT_FONT_SIZE, DEFAULT_SCROLLBACK } from '../../../shared/constants';
import { useSSHData, useSSHClose } from '../../hooks/use-ipc';
import { useTerminalStore } from '../../stores/terminal-store';

// ============================================================
// TerminalInstance — wraps a single xterm.js Terminal
// ============================================================

export interface TerminalInstanceProps {
  sessionId: string;
  isActive: boolean;
  theme: TerminalTheme;
}

function terminalThemeToXterm(theme: TerminalTheme): Record<string, string> {
  return {
    foreground: theme.foreground,
    background: theme.background,
    cursor: theme.cursor,
    cursorAccent: theme.cursorAccent,
    selectionBackground: theme.selection,
    black: theme.black,
    red: theme.red,
    green: theme.green,
    yellow: theme.yellow,
    blue: theme.blue,
    magenta: theme.magenta,
    cyan: theme.cyan,
    white: theme.white,
    brightBlack: theme.brightBlack,
    brightRed: theme.brightRed,
    brightGreen: theme.brightGreen,
    brightYellow: theme.brightYellow,
    brightBlue: theme.brightBlue,
    brightMagenta: theme.brightMagenta,
    brightCyan: theme.brightCyan,
    brightWhite: theme.brightWhite,
  };
}

export const TerminalInstance: React.FC<TerminalInstanceProps> = ({
  sessionId,
  isActive,
  theme,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const closedRef = useRef(false);

  const updateSession = useTerminalStore((s) => s.updateSession);

  // Initialize xterm.js on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      fontFamily: `'${DEFAULT_FONT}', 'Fira Code', 'Cascadia Code', Menlo, monospace`,
      fontSize: DEFAULT_FONT_SIZE,
      scrollback: DEFAULT_SCROLLBACK,
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true,
      theme: terminalThemeToXterm(theme),
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Web links addon — clickable URLs
    terminal.loadAddon(new WebLinksAddon());

    // Unicode11 for wider character support
    const unicode11 = new Unicode11Addon();
    terminal.loadAddon(unicode11);
    terminal.unicode.activeVersion = '11';

    // Open the terminal in the container
    terminal.open(containerRef.current);

    // Try WebGL renderer, fall back to canvas
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
      });
      terminal.loadAddon(webgl);
    } catch {
      // WebGL not available — xterm falls back to canvas renderer automatically
    }

    // Initial fit
    try {
      fitAddon.fit();
    } catch {
      // Container may not have dimensions yet
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // User keystrokes -> backend
    const dataDisposable = terminal.onData((data) => {
      window.nexus.ssh.write(sessionId, data);
    });

    // Right-click to paste clipboard contents
    const container = containerRef.current;
    const handleContextMenu = async (e: MouseEvent) => {
      e.preventDefault();
      // If there's a selection in the terminal, copy it; otherwise paste.
      const selection = terminal.getSelection();
      if (selection) {
        try {
          await navigator.clipboard.writeText(selection);
          terminal.clearSelection();
        } catch {
          // Clipboard write failed — ignore
        }
        return;
      }
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          terminal.paste(text);
        }
      } catch {
        // Clipboard read failed — ignore (permissions, no content, etc.)
      }
    };
    container.addEventListener('contextmenu', handleContextMenu);

    // ResizeObserver for auto-fit
    const observer = new ResizeObserver(() => {
      if (!fitAddonRef.current) return;
      try {
        fitAddonRef.current.fit();
        const { cols, rows } = terminal;
        if (cols > 0 && rows > 0) {
          window.nexus.ssh.resize(sessionId, cols, rows);
        }
      } catch {
        // ignore fit errors during transitions
      }
    });
    observer.observe(containerRef.current);
    resizeObserverRef.current = observer;

    return () => {
      container.removeEventListener('contextmenu', handleContextMenu);
      dataDisposable.dispose();
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      resizeObserverRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Backend output -> terminal
  const handleSSHData = useCallback((data: string) => {
    terminalRef.current?.write(data);
  }, []);

  useSSHData(sessionId, handleSSHData);

  // Connection close
  const handleSSHClose = useCallback(
    (code: number) => {
      closedRef.current = true;
      const msg =
        code === 0
          ? '\r\n\x1b[90m--- Connection closed ---\x1b[0m\r\n'
          : `\r\n\x1b[31m--- Connection closed (exit code: ${code}) ---\x1b[0m\r\n`;
      terminalRef.current?.write(msg);
      updateSession(sessionId, { connected: false });
    },
    [sessionId, updateSession]
  );

  useSSHClose(sessionId, handleSSHClose);

  // Signal the main process that the xterm is ready to receive data.
  // This flushes any PTY output that arrived before the terminal mounted
  // (e.g. the MOTD and shell prompt).
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    window.nexus.ssh.markReady(sessionId).then((buffered: string) => {
      if (cancelled) return;
      if (buffered) {
        terminalRef.current?.write(buffered);
      }
    }).catch(() => {
      // Session may no longer exist — ignore
    });
    return () => { cancelled = true; };
  }, [sessionId]);

  // Update theme when it changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = terminalThemeToXterm(theme);
    }
  }, [theme]);

  // Handle visibility and fit when becoming active
  useEffect(() => {
    if (isActive && fitAddonRef.current && terminalRef.current) {
      // Small delay to let the container become visible before fitting
      const raf = requestAnimationFrame(() => {
        try {
          fitAddonRef.current?.fit();
          const { cols, rows } = terminalRef.current!;
          if (cols > 0 && rows > 0) {
            window.nexus.ssh.resize(sessionId, cols, rows);
          }
        } catch {
          // ignore
        }
        terminalRef.current?.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [isActive, sessionId]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ display: isActive ? 'block' : 'none' }}
    />
  );
};
