/**
 * How a terminal session ended, and the line the terminal shows for it (#4322).
 * No Electron or ssh2 imports, so it is unit-tested directly.
 */

import type { SSHCloseInfo } from '../../shared/types';

export interface SessionEnd {
  /** Exit status from the shell's `exit-status` message, if it sent one. */
  exitCode?: number;
  /** Signal name from an `exit-signal` message (the shell was killed). */
  exitSignal?: string;
  /** The last client error (network, keepalive timeout, protocol). */
  error?: string;
}

/**
 * A shell that sent an exit status ended on purpose (the user typed `exit`, or its command
 * finished): no reconnect. Anything else (no status, killed by a signal, a client error) means
 * the connection was lost.
 */
export function classifyClose(sessionId: string, end: SessionEnd): SSHCloseInfo {
  if (end.exitCode !== undefined) {
    return { sessionId, reason: 'exit', exitCode: end.exitCode };
  }
  const error =
    end.error ?? (end.exitSignal ? `The remote shell was stopped (${end.exitSignal})` : 'The server closed the connection');
  return { sessionId, reason: 'dropped', error };
}

const GREY = '\x1b[90m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

const line = (colour: string, text: string) => `\r\n${colour}--- ${text} ---${RESET}\r\n`;

/** The line written into the terminal (and its replay buffer) when a session closes. */
export function closeMarker(info: SSHCloseInfo): string {
  if (info.reason === 'exit') {
    return info.exitCode
      ? line(GREY, `Connection closed (exit code: ${info.exitCode})`)
      : line(GREY, 'Connection closed');
  }
  return line(RED, `Connection lost: ${info.error ?? 'unknown error'}`);
}

/** The line written into the terminal when a dropped session connects again. */
export const RECONNECTED_MARKER = line(GREEN, 'Reconnected');
