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
}

// ---------------------------------------------------------------------------
// SSHManager
// ---------------------------------------------------------------------------

/** ssh2 handshake timeout, which includes waiting for the host-key prompt. */
export const HANDSHAKE_TIMEOUT_MS = 60_000;

class SSHManager {
  private sessions: Map<string, SSHSessionState> = new Map();
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
  }): Promise<string> {
    const {
      sessionId,
      hostId,
      label,
      colour,
      credentials,
      cols,
      rows,
    } = options;

    const client = new Client();

    const state: SSHSessionState = {
      id: sessionId,
      hostId,
      label,
      colour,
      client,
      channel: null,
      connected: false,
      startedAt: new Date().toISOString(),
      scrollbackBuffer: [],
      rendererReady: false,
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
              this.sendToRenderer(IPC.SSH_CLOSE, {
                sessionId,
                error: err.message,
              });
              this.cleanup(sessionId);
              return reject(err);
            }

            state.channel = channel;

            // Keep an in-memory scrollback of all PTY output so that if the
            // renderer's xterm instance re-mounts (React Strict Mode, tab
            // switch, etc.) it can replay the full history via markReady().
            const forwardOrBuffer = (data: Buffer) => {
              const text = data.toString('utf8');
              state.scrollbackBuffer.push(text);
              if (state.rendererReady) {
                this.sendToRenderer(IPC.SSH_DATA, { sessionId, data: text });
              }
            };

            channel.on('data', forwardOrBuffer);
            channel.stderr.on('data', forwardOrBuffer);

            channel.on('close', () => {
              this.sendToRenderer(IPC.SSH_CLOSE, { sessionId });
              this.cleanup(sessionId);
            });

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
        this.sendToRenderer(IPC.SSH_CLOSE, {
          sessionId,
          error: err.message,
        });
        this.cleanup(sessionId);
        reject(err);
      });

      // ---- Event: end -------------------------------------------------------
      client.on('end', () => {
        hostKey.dismiss();
        this.sendToRenderer(IPC.SSH_CLOSE, { sessionId });
        this.cleanup(sessionId);
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
        this.cleanup(sessionId);
        reject(err);
      }
    });
  }

  // -----------------------------------------------------------------------
  // disconnect
  // -----------------------------------------------------------------------

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      if (session.channel) {
        session.channel.close();
      }
      session.client.end();
    } catch {
      // Ignore errors during teardown
    }

    this.cleanup(sessionId);
  }

  // -----------------------------------------------------------------------
  // markRendererReady — called when the xterm instance has mounted.
  // Returns any buffered PTY output that arrived before the renderer was
  // ready so it can be written to the terminal. Subsequent data will be
  // streamed live via IPC.
  // -----------------------------------------------------------------------

  markRendererReady(sessionId: string): string {
    const session = this.sessions.get(sessionId);
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
    const session = this.sessions.get(sessionId);
    if (!session?.channel) return;

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
    for (const sessionId of this.sessions.keys()) {
      this.disconnect(sessionId);
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private cleanup(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.connected = false;
    session.channel = null;
    this.sessions.delete(sessionId);
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
