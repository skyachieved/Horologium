/*
 * JSON persistence in the user-data folder. Atomic writes (temp file + rename) and a debounce so
 * dragging the widget or logging cups does not hammer the disk. A corrupt file is moved aside
 * (never deleted) and the app starts from defaults.
 */
import fs from 'node:fs';
import path from 'node:path';
import { deepMerge, repairState } from '../core/defaults.js';

export function createStore({ file, language = 'en', debounceMs = 400 }) {
  let state;
  let timer = null;

  try {
    state = repairState(JSON.parse(fs.readFileSync(file, 'utf8')), language);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      try {
        fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
      } catch {
        /* nothing more we can do; defaults still work */
      }
    }
    state = repairState(null, language);
  }

  function writeNow() {
    clearTimeout(timer);
    timer = null;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('store: could not save', err.message);
    }
  }

  return {
    get: () => state,
    /** Deep-merge a patch (null deletes a key) and schedule a save. */
    patch(patch) {
      deepMerge(state, patch);
      clearTimeout(timer);
      timer = setTimeout(writeNow, debounceMs);
      return state;
    },
    flush: writeNow,
  };
}
