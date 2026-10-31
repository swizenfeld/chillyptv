import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, sendError, sendJson } from './util.js';

/**
 * Tiny key/value store so several devices pointed at the same ChillyPTV server
 * can share profiles, favourites, watch history and settings.
 */
export class StateStore {
  private readonly dir: string;
  constructor(dataDir: string) {
    this.dir = join(dataDir, 'state');
  }
  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }
  private file(key: string): string {
    return join(this.dir, `${key}.json`);
  }
  async get(key: string): Promise<string | null> {
    return readFile(this.file(key), 'utf8').catch(() => null);
  }
  async put(key: string, json: string): Promise<void> {
    await writeFile(this.file(key), json);
  }
}

export async function handleState(store: StateStore, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const key = path.split('/')[3] ?? '';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key)) return sendError(res, 400, 'Invalid key');
  if (req.method === 'GET') {
    const data = await store.get(key);
    if (data === null) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return void res.end(data);
  }
  if (req.method === 'PUT') {
    try {
      const body = await readBody(req, 20 * 1024 * 1024);
      JSON.parse(body);
      await store.put(key, body);
      return sendJson(res, 200, { ok: true, savedAt: Date.now() });
    } catch (e) {
      return sendError(res, 400, (e as Error).message);
    }
  }
  return sendError(res, 405, 'Method not allowed');
}
