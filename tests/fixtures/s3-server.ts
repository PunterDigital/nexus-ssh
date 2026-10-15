/**
 * Minimal in-memory S3-compatible server for tests: path-style PUT/GET/HEAD object on
 * 127.0.0.1. Accepts the AWS SDK's aws-chunked uploads (flexible checksums) and stores the
 * decoded body. Signatures aren't checked. Never point the app at a real bucket in tests.
 */

import http from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';

export interface S3TestServer {
  endpoint: string;
  objects: Map<string, { body: Buffer; lastModified: Date }>;
  close(): Promise<void>;
}

// aws-chunked: "<hex size>[;chunk-signature=...]\r\n<bytes>\r\n" ... "0\r\n<trailers>\r\n\r\n"
function decodeAwsChunked(raw: Buffer): Buffer {
  const out: Buffer[] = [];
  let pos = 0;
  for (;;) {
    const eol = raw.indexOf('\r\n', pos);
    const size = parseInt(raw.subarray(pos, eol).toString().split(';')[0], 16);
    if (!size) break;
    out.push(raw.subarray(eol + 2, eol + 2 + size));
    pos = eol + 2 + size + 2;
  }
  return Buffer.concat(out);
}

export async function startS3TestServer(): Promise<S3TestServer> {
  const objects = new Map<string, { body: Buffer; lastModified: Date }>();

  const server = http.createServer((req, res) => {
    const key = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const obj = objects.get(key);
      const headers = (o: { body: Buffer; lastModified: Date }) => ({
        'Content-Length': String(o.body.length),
        'Last-Modified': o.lastModified.toUTCString(),
        ETag: `"${createHash('md5').update(o.body).digest('hex')}"`,
      });

      if (req.method === 'PUT') {
        const raw = Buffer.concat(chunks);
        const chunked = String(req.headers['content-encoding'] ?? '').includes(
          'aws-chunked'
        );
        const body = chunked ? decodeAwsChunked(raw) : raw;
        // Whole seconds, like real S3's Last-Modified.
        const lastModified = new Date(Math.floor(Date.now() / 1000) * 1000);
        objects.set(key, { body, lastModified });
        res.writeHead(200, { ETag: headers({ body, lastModified }).ETag });
        return res.end();
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (!obj) {
          res.writeHead(404, { 'Content-Type': 'application/xml' });
          return res.end(
            req.method === 'GET'
              ? '<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>Not found</Message></Error>'
              : undefined
          );
        }
        res.writeHead(200, {
          ...headers(obj),
          'Content-Type': 'application/octet-stream',
        });
        return res.end(req.method === 'GET' ? obj.body : undefined);
      }
      res.writeHead(405);
      res.end();
    });
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as net.AddressInfo;

  return {
    endpoint: `http://127.0.0.1:${port}`,
    objects,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
