/*
 * Range-aware file responses for audio. The <audio> element needs `Accept-Ranges`, `Content-Length` and 206
 * partial responses to learn a file's duration and to seek; a plain 200 with no length makes long files
 * look endless and unseekable. Node-only (no Electron import), so it is unit-tested.
 */
import fs from 'node:fs';
import { Readable } from 'node:stream';

/** "bytes=10-19", "bytes=10-", "bytes=-500" against a file of `size` bytes -> {start, end} or null if unsatisfiable. */
export function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

const stream = (file, options) => Readable.toWeb(fs.createReadStream(file, options));

/**
 * @param {string} file
 * @param {{headers?: Headers | Record<string,string>}} request
 * @param {string} type  content type
 */
export async function serveFileWithRange(file, request, type) {
  const { size } = await fs.promises.stat(file);
  const header = request.headers?.get ? request.headers.get('range') : request.headers?.range;
  const base = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-store' };

  if (!header) {
    return new Response(stream(file), { status: 200, headers: { ...base, 'content-length': String(size) } });
  }
  const range = parseRange(header, size);
  if (!range) return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${size}` } });
  const { start, end } = range;
  return new Response(stream(file, { start, end }), {
    status: 206,
    headers: { ...base, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) },
  });
}
