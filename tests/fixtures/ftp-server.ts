/**
 * Minimal throwaway FTP server for tests: one user, passive mode (EPSV/PASV) on 127.0.0.1,
 * and just enough commands for the FTP sync backend (STOR, RETR, SIZE, MDTM). Files live in
 * a temp dir. Never point the app at a real FTP host in tests.
 */

import net from 'node:net';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface FtpTestServer {
  port: number;
  close(): Promise<void>;
}

export interface FtpTestServerOptions {
  root: string;
  username: string;
  password: string;
}

const mdtm = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14);

export async function startFtpTestServer(
  opts: FtpTestServerOptions
): Promise<FtpTestServer> {
  const sockets = new Set<net.Socket>();

  const server = net.createServer((control) => {
    sockets.add(control);
    control.on('close', () => sockets.delete(control));
    control.on('error', () => {});

    let user = '';
    let loggedIn = false;
    let data: Promise<net.Socket> | null = null;
    const reply = (line: string) => control.write(`${line}\r\n`);

    const resolvePath = (p: string): string | null => {
      const full = path.resolve(opts.root, p.replace(/^\/+/, ''));
      return full.startsWith(path.resolve(opts.root)) ? full : null;
    };

    // Each EPSV/PASV opens a one-shot listener for a single data connection.
    const openPassive = async (): Promise<number> => {
      const listener = net.createServer();
      await new Promise<void>((r) => listener.listen(0, '127.0.0.1', r));
      data = new Promise((resolve) =>
        listener.once('connection', (sock) => {
          sockets.add(sock);
          sock.on('close', () => sockets.delete(sock));
          listener.close();
          resolve(sock);
        })
      );
      return (listener.address() as net.AddressInfo).port;
    };

    const takeData = async (): Promise<net.Socket | null> => {
      const pending = data;
      data = null;
      return pending ? await pending : null;
    };

    const handle = async (line: string) => {
      const space = line.indexOf(' ');
      const cmd = (space === -1 ? line : line.slice(0, space)).toUpperCase();
      const arg = space === -1 ? '' : line.slice(space + 1);

      if (cmd === 'USER') return reply(((user = arg), '331 Password required'));
      if (cmd === 'PASS') {
        loggedIn = user === opts.username && arg === opts.password;
        return reply(loggedIn ? '230 Logged in' : '530 Login incorrect');
      }
      if (cmd === 'QUIT') return reply('221 Bye');
      if (cmd === 'FEAT')
        return reply('211-Features:\r\n EPSV\r\n SIZE\r\n MDTM\r\n UTF8\r\n211 End');
      if (!loggedIn) return reply('530 Not logged in');

      const file = resolvePath(arg);
      switch (cmd) {
        case 'TYPE':
        case 'STRU':
        case 'OPTS':
          return reply('200 OK');
        case 'PWD':
          return reply('257 "/" is the current directory');
        case 'EPSV':
          return reply(`229 Entering Extended Passive Mode (|||${await openPassive()}|)`);
        case 'PASV': {
          const port = await openPassive();
          return reply(
            `227 Entering Passive Mode (127,0,0,1,${port >> 8},${port & 255})`
          );
        }
        case 'SIZE':
          if (!file || !existsSync(file)) return reply('550 No such file');
          return reply(`213 ${statSync(file).size}`);
        case 'MDTM':
          if (!file || !existsSync(file)) return reply('550 No such file');
          return reply(`213 ${mdtm(statSync(file).mtime)}`);
        case 'STOR': {
          const sock = await takeData();
          if (!sock || !file) return reply('425 No data connection');
          reply('150 Ready to receive');
          const chunks: Buffer[] = [];
          sock.on('data', (c: Buffer) => chunks.push(c));
          await new Promise((r) => sock.on('close', r));
          mkdirSync(path.dirname(file), { recursive: true });
          writeFileSync(file, Buffer.concat(chunks));
          return reply('226 Transfer complete');
        }
        case 'RETR': {
          const sock = await takeData();
          if (!file || !existsSync(file)) {
            sock?.destroy();
            return reply('550 No such file');
          }
          if (!sock) return reply('425 No data connection');
          reply('150 Sending');
          await new Promise<void>((r) => sock.end(readFileSync(file), r));
          return reply('226 Transfer complete');
        }
        default:
          return reply('502 Command not implemented');
      }
    };

    // Commands are handled one at a time, in order.
    let buffer = '';
    let queue = Promise.resolve();
    control.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        queue = queue.then(() => handle(line)).catch(() => reply('451 Local error'));
      }
    });

    reply('220 Nexus test FTP server');
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

  return {
    port: (server.address() as net.AddressInfo).port,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
