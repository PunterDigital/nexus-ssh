/**
 * SSH Connection Manager
 * Manages SSH sessions using the ssh2 library with TOFU host-key verification,
 * PTY allocation, and IPC-based communication with the renderer process.
 */

import { Client, type ConnectConfig, type ClientChannel } from 'ssh2';
import type { BrowserWindow} from 'electron';
import { IPC, DEFAULT_KEEPALIVE_INTERVAL } from '../../shared/constants';
import type { ResolvedCredentials, SSHSession } from '../../shared/types';
import { createHostVerifier } from './host-key';
import { classifyClose, closeMarker, RECONNECTED_MARKER } from './session-close';

// ---------------------------------------------------------------------------
// Internal state type
// ---------------------------------------------------------------------------

interface SSHSessionState {
  id: string;
  hostId: string;
  label: string;
  colour: string | null;
  client: Client;
  channel: ClientChannel | null;
  connected: boolean;
  startedAt: string;
  /** All PTY output since connect — used to replay history on (re)mount. */
  scrollbackBuffer: string[];
  /** True once the renderer's xterm instance has mounted and called markReady. */
  rendererReady: boolean;
  /** Last PTY size, so a reconnect opens the shell at the terminal's size. */
  cols: number;
  rows: number;
  /** The shell is open and connect() has resolved: a close from now on is reported. */
  established: boolean;
  /** The session has ended (either side); later events are ignored. */
  finished: boolean;
  exitCode?: number;
  exitSignal?: string;
  lastError?: string;
}

/**
 * What is kept of a session after it closed on its own (#4322): its output, so the terminal can
 * still replay it after a view switch, and what a reconnect needs. Dropped when the user closes
 * the tab (disconnect) or every session goes (lock, vault switch, quit).
 */
interface RetainedSession {
  hostId: string;
  label: string;
  colour: string | null;
  scrollbackBuffer: string[];
  rendererReady: boolean;
  cols: number;
  rows: number;
  /** Only a lost connection reconnects; a shell that exited stays closed. */
  reconnectable: boolean;
}

// ---------------------------------------------------------------------------
// SSHManager
// ---------------------------------------------------------------------------

/** ssh2 handshake timeout, which includes waiting for the host-key prompt. */
export const HANDSHAKE_TIMEOUT_MS = 60_000;

class SSHManager {
  private sessions: Map<string, SSHSessionState> = new Map();
  private retained: Map<string, RetainedSession> = new Map();
  private mainWindow: BrowserWindow | null = null;

  /** Register the main BrowserWindow so IPC events can be sent to the renderer. */
  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
  }

  // -----------------------------------------------------------------------
  // connect
  // -----------------------------------------------------------------------

  async connect(options: {
    sessionId: string;
    hostId: string;
    label: string;
    colour: string | null;
    credentials: ResolvedCredentials;
    cols: number;
    rows: number;
    /** Reconnect a dropped session under its old id, keeping its output (#4322). */
    reconnect?: boolean;
  }): Promise<string> {
    const {
      sessionId,
      hostId,
      label,
      colour,
      credentials,
      reconnect,
    } = options;

    if (this.sessions.has(sessionId)) {
      throw new Error('This session is already connecting or connected');
    }
    const previous = reconnect ? this.retained.get(sessionId) : undefined;
    if (reconnect && !previous?.reconnectable) {
      throw new Error('This session can no longer reconnect');
    }

    const client = new Client();
    const cols = previous?.cols ?? options.cols;
    const rows = previous?.rows ?? options.rows;

    const state: SSHSessionState = {
      id: sessionId,
      hostId,
      label,
      colour,
      client,
      channel: null,
      connected: false,
      startedAt: new Date().toISOString(),
      // A reconnect continues the old output, so a remount replays all of it.
      scrollbackBuffer: previous ? [...previous.scrollbackBuffer] : [],
      rendererReady: previous?.rendererReady ?? false,
      cols,
      rows,
      established: false,
      finished: false,
    };

    this.sessions.set(sessionId, state);

    const hostKey = createHostVerifier(credentials.hostname, credentials.port);

    return new Promise<string>((resolve, reject) => {
      // ---- Event: ready — open a PTY shell ----------------------------------
      client.on('ready', () => {
        state.connected = true;

        client.shell(
          {
            term: 'xterm-256color',
            cols,
            rows,
          },
          (err, channel) => {
            if (err) {
              state.lastError = err.message;
              this.finish(state);
              return reject(err);
            }

            if (state.finished) {
              // The connection went away while the shell was opening.
              try { channel.close(); } catch { /* ignore */ }
              return reject(new Error(state.lastError ?? 'The connection closed'));
            }

            state.channel = channel;

            // Keep an in-memory scrollback of all PTY output so that if the
            // renderer's xterm instance re-mounts (React Strict Mode, tab
            // switch, etc.) it can replay the full history via markReady().
            const forwardOrBuffer = (data: Buffer) => {
              this.output(state, data.toString('utf8'));
            };

            channel.on('data', forwardOrBuffer);
            channel.stderr.on('data', forwardOrBuffer);

            // An exit status means the shell ended on purpose; a signal means it was killed.
            channel.on('exit', (code: number | null, signal?: string) => {
              if (typeof code === 'number') state.exitCode = code;
              else if (signal) state.exitSignal = signal;
            });

            channel.on('close', () => this.finish(state));

            state.established = true;
            if (previous) {
              this.retained.delete(sessionId);
              this.output(state, RECONNECTED_MARKER);
            }
            resolve(sessionId);
          },
        );
      });

      // ---- Event: error -----------------------------------------------------
      client.on('error', (rawErr) => {
        // A connection that dies while the host-key prompt is open closes the prompt too.
        hostKey.dismiss();
        const err = hostKey.rejected
          ? new Error(`Host key for ${credentials.hostname}:${credentials.port} was not trusted`)
          : rawErr;
        state.lastError = err.message;
        this.finish(state);
        reject(err);
      });

      // ---- Event: end / close -------------------------------------------------
      // Rejecting after connect() resolved does nothing, so these only matter mid-handshake.
      client.on('end', () => {
        hostKey.dismiss();
        this.finish(state);
        reject(new Error(state.lastError ?? 'The server closed the connection'));
      });
      client.on('close', () => {
        hostKey.dismiss();
        this.finish(state);
        reject(new Error(state.lastError ?? 'The connection closed'));
      });

      // ---- Build ConnectConfig ----------------------------------------------
      const connectConfig: ConnectConfig = {
        host: credentials.hostname,
        port: credentials.port,
        username: credentials.username,
        // The handshake includes the host-key prompt, so leave time to read the fingerprint.
        readyTimeout: HANDSHAKE_TIMEOUT_MS,
        keepaliveInterval: (DEFAULT_KEEPALIVE_INTERVAL) * 1_000,

        // Host-key verification (TOFU): waits for known_hosts or the user's answer.
        hostVerifier: hostKey.hostVerifier,
      };

      // --- Auth: privateKey --------------------------------------------------
      if (credentials.privateKey) {
        connectConfig.privateKey = credentials.privateKey;
        if (credentials.passphrase) {
          connectConfig.passphrase = credentials.passphrase;
        }
      }

      // --- Auth: password ----------------------------------------------------
      if (credentials.password) {
        connectConfig.password = credentials.password;
      }

      // --- Auth: keyboard-interactive ----------------------------------------
      // ssh2 will attempt configured auth methods automatically.
      // We wire up keyboard-interactive to relay prompts to the renderer.
      connectConfig.tryKeyboard = true;
      client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
        // For most servers the prompt is just the password prompt.
        // If we already have a password, respond with it automatically.
        if (credentials.password && prompts.length > 0) {
          const responses = prompts.map(() => credentials.password as string);
          finish(responses);
        } else {
          // No password available — send empty responses so ssh2 can continue
          // to the next auth method rather than hanging.
          finish(prompts.map(() => ''));
        }
      });

      // ---- Connect ----------------------------------------------------------
      try {
        client.connect(connectConfig);
      } catch (err: unknown) {
        state.finished = true;
        this.cleanup(state);
        reject(err);
      }
    });
  }

  /** The host a dropped session belongs to, if it can still reconnect. */
  reconnectTarget(sessionId: string): { hostId: string } | null {
    if (this.sessions.has(sessionId)) return null;
    const retained = this.retained.get(sessionId);
    return retained?.reconnectable ? { hostId: retained.hostId } : null;
  }

  // -----------------------------------------------------------------------
  // disconnect — the user closed the session: no close event, nothing kept
  // -----------------------------------------------------------------------

  disconnect(sessionId: string): void {
    this.retained.delete(sessionId);
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.finished = true;
    try {
      if (session.channel) {
        session.channel.close();
      }
      session.client.end();
    } catch {
      // Ignore errors during teardown
    }

    this.cleanup(session);
  }

  // -----------------------------------------------------------------------
  // markRendererReady — called when the xterm instance has mounted.
  // Returns any buffered PTY output that arrived before the renderer was
  // ready so it can be written to the terminal. Subsequent data will be
  // streamed live via IPC.
  // -----------------------------------------------------------------------

  markRendererReady(sessionId: string): string {
    // A closed session still replays its output (and the close line) after a view switch.
    const session = this.sessions.get(sessionId) ?? this.retained.get(sessionId);
    if (!session) return '';
    // Return the full scrollback so the renderer can replay history.
    // We leave the buffer in place so subsequent remounts (Strict Mode,
    // tab switches) also get the same history.
    const buffered = session.scrollbackBuffer.join('');
    session.rendererReady = true;
    return buffered;
  }

  // -----------------------------------------------------------------------
  // write
  // -----------------------------------------------------------------------

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session?.channel) return;

    try {
      session.channel.write(data);
    } catch {
      // Channel may have been closed between the check and the write
    }
  }

  // -----------------------------------------------------------------------
  // resize
  // -----------------------------------------------------------------------

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId) ?? this.retained.get(sessionId);
    if (!session) return;
    session.cols = cols;
    session.rows = rows;
    if (!('channel' in session) || !session.channel) return;

    try {
      session.channel.setWindow(rows, cols, 0, 0);
    } catch {
      // Ignore — channel might already be closed
    }
  }

  // -----------------------------------------------------------------------
  // listSessions
  // -----------------------------------------------------------------------

  listSessions(): SSHSession[] {
    const list: SSHSession[] = [];
    for (const s of this.sessions.values()) {
      list.push({
        id: s.id,
        hostId: s.hostId,
        label: s.label,
        colour: s.colour,
        connected: s.connected,
        status: s.connected ? 'connected' : 'disconnected',
        startedAt: s.startedAt,
      });
    }
    return list;
  }

  // -----------------------------------------------------------------------
  // getClient — allows SFTP module to reuse the ssh2 connection
  // -----------------------------------------------------------------------

  getClient(sessionId: string): Client | null {
    return this.sessions.get(sessionId)?.client ?? null;
  }

  // -----------------------------------------------------------------------
  // destroyAll
  // -----------------------------------------------------------------------

  destroyAll(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      this.disconnect(sessionId);
    }
    this.retained.clear();
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** PTY output (or a status line): kept for replay, streamed once the xterm is ready. */
  private output(state: SSHSessionState, text: string): void {
    state.scrollbackBuffer.push(text);
    if (state.rendererReady) {
      this.sendToRenderer(IPC.SSH_DATA, { sessionId: state.id, data: text });
    }
  }

  /**
   * The session ended on its own (shell exit, lost connection, error). Runs once per session.
   * Before the shell is open, connect() rejects instead and nothing is reported.
   */
  private finish(state: SSHSessionState): void {
    if (state.finished) return;
    state.finished = true;
    try {
      state.client.end();
    } catch {
      // already closed
    }
    this.cleanup(state);
    if (!state.established) return;

    const info = classifyClose(state.id, {
      exitCode: state.exitCode,
      exitSignal: state.exitSignal,
      error: state.lastError,
    });
    this.output(state, closeMarker(info));
    this.retained.set(state.id, {
      hostId: state.hostId,
      label: state.label,
      colour: state.colour,
      scrollbackBuffer: state.scrollbackBuffer,
      rendererReady: state.rendererReady,
      cols: state.cols,
      rows: state.rows,
      reconnectable: info.reason === 'dropped',
    });
    this.sendToRenderer(IPC.SSH_CLOSE, info);
  }

  private cleanup(state: SSHSessionState): void {
    state.connected = false;
    state.channel = null;
    // A late event from an old connection must not remove a newer one with the same id.
    if (this.sessions.get(state.id) === state) this.sessions.delete(state.id);
  }

  private sendToRenderer(channel: string, data: unknown): void {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send(channel, data);
      }
    } catch {
      // Window may have been destroyed between the check and the send
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const sshManager = new SSHManager();
