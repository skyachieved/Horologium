/*
 * Folder scanning for the "My music" source. Node-only (no Electron import) so it is unit-tested.
 * Only file names are read: no tag parsing, no network, no copying. The user picks the folder explicitly.
 */
import fs from 'node:fs';
import path from 'node:path';

export const AUDIO_EXTENSIONS = Object.freeze(['.mp3', '.ogg', '.oga', '.opus', '.flac', '.wav', '.m4a', '.aac', '.weba']);

export const AUDIO_MIME = Object.freeze({
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.weba': 'audio/webm',
});

export const isAudioFile = (name) => AUDIO_EXTENSIONS.includes(path.extname(name).toLowerCase());

/** "01 - Night Drive.mp3" -> "Night Drive" (a leading track number and dashes/underscores are tidied). */
export function titleFromFile(file) {
  const base = path.basename(file, path.extname(file));
  return base.replace(/^\s*\d{1,3}\s*[-._)\s]+\s*/, '').replace(/[_]+/g, ' ').trim() || base;
}

/**
 * @returns {{file: string, title: string}[]} relative paths with forward slashes, sorted naturally
 */
export function scanFolder(root, { maxFiles = 3000, maxDepth = 6 } = {}) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth || out.length >= maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable folder: skip it
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && isAudioFile(entry.name)) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        out.push({ file: rel, title: titleFromFile(entry.name) });
      }
    }
  };
  walk(root, 0);
  return out.sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true, sensitivity: 'base' }));
}
