/*
 * JSON persistence in the user-data folder. Atomic writes (temp file + rename), batched so dragging the
 * widget or logging cups does not hammer the disk. A corrupt file is moved aside (never deleted) and the
 * app starts from defaults.
 *
 * Batching is a fixed delay from the FIRST unsaved change, not a debounce: a debounce that restarts on every
 * patch never fires while changes keep coming, and a feedback loop once kept a whole session from being saved.
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
      if (!timer) timer = setTimeout(writeNow, debounceMs); // later patches ride along with this write
      return state;
    },
    flush: writeNow,
  };
}
