/*
 * The `horologium://app/...` protocol: a single secure origin that serves
 *   /ext/<bundled|user>/...   extension files (themes, characters, fonts, scenes)
 *   /core/...                 the pure ES modules from src/core (shared with the renderer)
 *   /media/<id>/...           audio files inside a folder the user chose for "My music" (audio types only)
 *   everything else           src/renderer
 * Using one origin avoids file:// quirks (ES modules, CORS) and lets us attach a strict CSP.
 * Every path is resolved and checked to stay inside its root (no ../ escapes).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { AUDIO_MIME } from './media-scan.js';

export const SCHEME = 'horologium';
export const ORIGIN = `${SCHEME}://app`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  ...AUDIO_MIME,
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

export const CSP = [
  "default-src 'none'",
  `script-src ${SCHEME}:`,
  `style-src ${SCHEME}: 'unsafe-inline'`,
  `img-src ${SCHEME}: data:`,
  `font-src ${SCHEME}: data:`,
  `connect-src ${SCHEME}:`,
  `media-src ${SCHEME}: blob:`,
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Resolve `rel` under `root`, or null if it would escape. Exported for tests. */
export function resolveInside(root, rel) {
  const full = path.resolve(root, `.${path.sep}${rel}`);
  const base = path.resolve(root);
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

/**
 * @param {{rendererRoot: string, coreRoot: string, bundledExtRoot: string, userExtRoot: string|null,
 *          mediaRoots?: () => Record<string, string>,
 *          serveFile?: (file: string, request: Request, type: string) => Promise<Response>}} roots
 *   mediaRoots  folder id -> absolute path, re-read on every request (the user can add/remove folders)
 *   serveFile   how to send a media file (the app passes a range-aware one so seeking works)
 * @returns {(request: Request) => Promise<Response>}
 */
export function createHandler(roots) {
  const respond = (status, body, type = 'text/plain; charset=utf-8') =>
    new Response(body, { status, headers: { 'content-type': type, 'content-security-policy': CSP, 'cache-control': 'no-store' } });

  return async function handle(request) {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return respond(400, 'bad url');
    }
    if (url.hostname !== 'app') return respond(404, 'not found');

    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return respond(400, 'bad path');
    }
    if (rel.includes('\0')) return respond(400, 'bad path');
    if (rel === '/' || rel === '') rel = '/index.html';

    let root;
    let sub;
    let m;
    if ((m = /^\/media\/([a-z0-9]+)\/(.+)$/.exec(rel))) {
      const folder = roots.mediaRoots?.()[m[1]];
      if (!folder) return respond(404, 'not found');
      const file = resolveInside(folder, m[2]);
      if (!file) return respond(403, 'forbidden');
      const audioType = AUDIO_MIME[path.extname(file).toLowerCase()];
      if (!audioType) return respond(404, 'not found'); // only audio is ever served from a media folder
      try {
        await fs.access(file);
        return roots.serveFile ? await roots.serveFile(file, request, audioType) : new Response(await fs.readFile(file), { status: 200, headers: { 'content-type': audioType } });
      } catch {
        return respond(404, 'not found');
      }
    }
    if ((m = /^\/ext\/(bundled|user)\/(.+)$/.exec(rel))) {
      root = m[1] === 'bundled' ? roots.bundledExtRoot : roots.userExtRoot;
      sub = m[2];
    } else if ((m = /^\/core\/(.+)$/.exec(rel))) {
      root = roots.coreRoot;
      sub = m[1];
    } else {
      root = roots.rendererRoot;
      sub = rel.slice(1);
    }
    if (!root) return respond(404, 'not found');

    const file = resolveInside(root, sub);
    if (!file) return respond(403, 'forbidden');
    const type = MIME[path.extname(file).toLowerCase()];
    if (!type) return respond(404, 'not found'); // only serve known, harmless types
    try {
      if (type.startsWith('audio/') && roots.serveFile) return await roots.serveFile(file, request, type); // range-aware: seeking works
      return respond(200, await fs.readFile(file), type);
    } catch {
      return respond(404, 'not found');
    }
  };
}
