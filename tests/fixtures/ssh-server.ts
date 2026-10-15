/**
 * Throwaway SSH + SFTP server for tests. Never point tests at real hosts.
 *
 * - Password auth with a fixed test user.
 * - A minimal line shell: echoes keystrokes, records each entered line in
 *   `commands`, and answers `echo <text>` with `<text>`.
 * - An SFTP subsystem backed by a real directory (`root`), so tests can check
 *   transferred files byte for byte.
 * - Optional per-request delays so transfers are slow enough to pause.
 */

import { Server, utils, type Connection, type SFTPWrapper } from 'ssh2';
import * as fs from 'node:fs';
import * as path from 'node:path';

const { STATUS_CODE } = utils.sftp;

export interface TestServerOptions {
  /** Directory the SFTP subsystem serves as "/". */
  root: string;
  username?: string;
  password?: string;
  /** Delay before acknowledging each SFTP WRITE (slows uploads). */
  writeDelayMs?: number;
  /** Delay before answering each SFTP READ (slows downloads). */
  readDelayMs?: number;
}

export interface TestServer {
  host: string;
  port: number;
  username: string;
  password: string;
  /** Lines entered in shell sessions, in order. */
  commands: string[];
  close: () => Promise<void>;
}

const PROMPT = 'nexus-test-shell$ ';

export async function startTestServer(opts: TestServerOptions): Promise<TestServer> {
  const username = opts.username ?? 'tester';
  const password = opts.password ?? 'test-password';
  const hostKey = utils.generateKeyPairSync('ed25519').private;
  const clients = new Set<Connection>();
  const commands: string[] = [];

  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    clients.add(client);
    client.on('close', () => clients.delete(client));
    client.on('error', () => {});

    client.on('authentication', (ctx) => {
      if (
        ctx.method === 'password' &&
        ctx.username === username &&
        ctx.password === password
      ) {
        ctx.accept();
      } else {
        ctx.reject(['password']);
      }
    });

    client.on('ready', () => {
      client.on('session', (acceptSession) => {
        const session = acceptSession();
        session.on('pty', (accept) => accept?.());
        session.on('window-change', (accept) => accept?.());
        session.on('env', (accept) => accept?.());
        session.on('shell', (accept) => {
          const stream = accept();
          let line = '';
          stream.write(PROMPT);
          // Echo keystrokes like a pty; on Enter, record the line and answer `echo <text>`.
          stream.on('data', (data: Buffer) => {
            for (const ch of data.toString('utf8')) {
              if (ch === '\r' || ch === '\n') {
                commands.push(line);
                const out = line.startsWith('echo ') ? `${line.slice(5)}\r\n` : '';
                stream.write(`\r\n${out}${PROMPT}`);
                line = '';
              } else if (ch === '\x7f') {
                if (line) stream.write('\b \b');
                line = line.slice(0, -1);
              } else {
                line += ch;
                stream.write(ch);
              }
            }
          });
        });
        session.on('sftp', (accept) => serveSftp(accept(), opts));
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as { port: number };

  return {
    host: '127.0.0.1',
    port,
    username,
    password,
    commands,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of clients) c.end();
        server.close(() => resolve());
      }),
  };
}

// ---------------------------------------------------------------------------
// SFTP subsystem
// ---------------------------------------------------------------------------

function serveSftp(sftp: SFTPWrapper, opts: TestServerOptions): void {
  const root = path.resolve(opts.root);
  const handles = new Map<number, { fd?: number; dir?: string; listed?: boolean }>();
  let nextHandle = 1;

  const toLocal = (p: string): string => {
    const local = path.resolve(root, '.' + path.posix.normalize('/' + p));
    if (local !== root && !local.startsWith(root + path.sep))
      throw new Error('path escapes root');
    return local;
  };
  const toPosix = (p: string): string => path.posix.normalize('/' + p);
  const handleBuf = (id: number): Buffer => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(id);
    return b;
  };
  const handleId = (b: Buffer): number => (b.length === 4 ? b.readUInt32BE(0) : -1);
  const attrsOf = (st: fs.Stats) => ({
    mode: st.mode,
    uid: 0,
    gid: 0,
    size: st.size,
    atime: Math.floor(st.atimeMs / 1000),
    mtime: Math.floor(st.mtimeMs / 1000),
  });
  const statusFor = (err: NodeJS.ErrnoException): number =>
    err.code === 'ENOENT'
      ? STATUS_CODE.NO_SUCH_FILE
      : err.code === 'EACCES' || err.code === 'EPERM'
        ? STATUS_CODE.PERMISSION_DENIED
        : STATUS_CODE.FAILURE;
  const guard = (reqid: number, fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      sftp.status(reqid, statusFor(err as NodeJS.ErrnoException));
    }
  };
  const later = (ms: number | undefined, fn: () => void): void => {
    if (ms && ms > 0) setTimeout(fn, ms);
    else fn();
  };

  sftp.on('REALPATH', (reqid, p) => {
    const abs = toPosix(p === '.' || p === '' ? '/' : p);
    sftp.name(reqid, [{ filename: abs, longname: abs, attrs: {} as never }]);
  });

  const onStat = (reqid: number, p: string) =>
    guard(reqid, () => sftp.attrs(reqid, attrsOf(fs.statSync(toLocal(p)))));
  sftp.on('STAT', onStat);
  sftp.on('LSTAT', onStat);

  sftp.on('FSTAT', (reqid, h) => {
    const entry = handles.get(handleId(h));
    if (!entry?.fd) return sftp.status(reqid, STATUS_CODE.FAILURE);
    guard(reqid, () => sftp.attrs(reqid, attrsOf(fs.fstatSync(entry.fd!))));
  });

  sftp.on('OPEN', (reqid, filename, flags) => {
    guard(reqid, () => {
      const mode = utils.sftp.flagsToString(flags) ?? 'r';
      const fd = fs.openSync(toLocal(filename), mode);
      const id = nextHandle++;
      handles.set(id, { fd });
      sftp.handle(reqid, handleBuf(id));
    });
  });

  sftp.on('READ', (reqid, h, offset, length) => {
    const entry = handles.get(handleId(h));
    if (entry?.fd === undefined) return sftp.status(reqid, STATUS_CODE.FAILURE);
    later(opts.readDelayMs, () =>
      guard(reqid, () => {
        const buf = Buffer.alloc(length);
        const n = fs.readSync(entry.fd!, buf, 0, length, offset);
        if (n === 0) sftp.status(reqid, STATUS_CODE.EOF);
        else sftp.data(reqid, buf.subarray(0, n));
      })
    );
  });

  sftp.on('WRITE', (reqid, h, offset, data) => {
    const entry = handles.get(handleId(h));
    if (entry?.fd === undefined) return sftp.status(reqid, STATUS_CODE.FAILURE);
    later(opts.writeDelayMs, () =>
      guard(reqid, () => {
        fs.writeSync(entry.fd!, data, 0, data.length, offset);
        sftp.status(reqid, STATUS_CODE.OK);
      })
    );
  });

  sftp.on('CLOSE', (reqid, h) => {
    const id = handleId(h);
    const entry = handles.get(id);
    if (!entry) return sftp.status(reqid, STATUS_CODE.FAILURE);
    handles.delete(id);
    guard(reqid, () => {
      if (entry.fd !== undefined) fs.closeSync(entry.fd);
      sftp.status(reqid, STATUS_CODE.OK);
    });
  });

  sftp.on('OPENDIR', (reqid, p) => {
    guard(reqid, () => {
      const dir = toLocal(p);
      if (!fs.statSync(dir).isDirectory())
        throw Object.assign(new Error('not a dir'), { code: 'ENOENT' });
      const id = nextHandle++;
      handles.set(id, { dir });
      sftp.handle(reqid, handleBuf(id));
    });
  });

  sftp.on('READDIR', (reqid, h) => {
    const entry = handles.get(handleId(h));
    if (!entry?.dir) return sftp.status(reqid, STATUS_CODE.FAILURE);
    if (entry.listed) return sftp.status(reqid, STATUS_CODE.EOF);
    entry.listed = true;
    guard(reqid, () => {
      const names = fs.readdirSync(entry.dir!).map((filename) => ({
        filename,
        longname: filename,
        attrs: attrsOf(fs.statSync(path.join(entry.dir!, filename))),
      }));
      if (names.length === 0) sftp.status(reqid, STATUS_CODE.EOF);
      else sftp.name(reqid, names);
    });
  });

  const ok = (reqid: number, fn: () => void) =>
    guard(reqid, () => {
      fn();
      sftp.status(reqid, STATUS_CODE.OK);
    });
  sftp.on('MKDIR', (reqid, p) => ok(reqid, () => fs.mkdirSync(toLocal(p))));
  sftp.on('RMDIR', (reqid, p) => ok(reqid, () => fs.rmdirSync(toLocal(p))));
  sftp.on('REMOVE', (reqid, p) => ok(reqid, () => fs.unlinkSync(toLocal(p))));
  sftp.on('RENAME', (reqid, from, to) =>
    ok(reqid, () => fs.renameSync(toLocal(from), toLocal(to)))
  );
  sftp.on('SETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));
  sftp.on('FSETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));
}
