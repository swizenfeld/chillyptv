import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export async function serveStatic(req: IncomingMessage, res: ServerResponse, root: string, pathname: string): Promise<boolean> {
  const rootAbs = resolve(root);
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = normalize(join(rootAbs, rel));
  if (file !== rootAbs && !file.startsWith(rootAbs + sep)) return false;
  let info = await stat(file).catch(() => null);
  if (!info || !info.isFile()) {
    // SPA fallback for client-side routes (no file extension).
    if (extname(rel)) return false;
    file = join(rootAbs, 'index.html');
    info = await stat(file).catch(() => null);
    if (!info) return false;
  }
  const ext = extname(file);
  const immutable = file.includes(`${join(rootAbs, 'assets')}`);
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}
