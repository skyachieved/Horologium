/*
 * What the character says (owner's note 10: "give them life in a sense by changing their dialogue to match their
 * theme"). PURE. A theme has a voice (dialogue.json); a character may override situations with its own
 * personality. Lines are picked per "slot" (a stretch of time), so the bubble changes now and then instead of
 * flickering every tick, and the same slot always shows the same line.
 */
import { DIALOGUE_SITUATIONS, DIALOGUE_PLACEHOLDERS } from './contracts/index.js';

/** Placeholder problems the schema cannot see (a {name} the situation does not provide). */
export function checkDialogue(data) {
  const problems = [];
  for (const situation of DIALOGUE_SITUATIONS) {
    const allowed = DIALOGUE_PLACEHOLDERS[situation];
    for (const lang of ['en', 'ko']) {
      for (const line of data?.[situation]?.[lang] ?? []) {
        for (const [, name] of line.matchAll(/\{(\w+)\}/g)) {
          if (!allowed.includes(name)) problems.push(`${situation}.${lang}: "{${name}}" is not available here (allowed: ${allowed.map((a) => `{${a}}`).join(', ') || 'none'})`);
        }
      }
    }
  }
  return problems;
}

/** Character lines replace the theme's for every situation the character defines. */
export function mergeDialogue(theme = null, character = null) {
  const out = {};
  for (const situation of DIALOGUE_SITUATIONS) {
    const lines = character?.[situation] ?? theme?.[situation];
    if (lines) out[situation] = lines;
  }
  return out;
}

const hash = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
};

/**
 * One line for a situation, in `lang` (falling back to English), with {placeholders} filled from `vars`.
 * Returns null when there are no lines (the caller falls back to the shell's generic text).
 */
export function pickLine(dialogue, situation, lang, { slot = 0, vars = {} } = {}) {
  const set = dialogue?.[situation];
  const lines = set?.[lang]?.length ? set[lang] : set?.en;
  if (!lines?.length) return null;
  const line = lines[hash(`${situation}:${slot}`) % lines.length];
  return line.replace(/\{(\w+)\}/g, (m, name) => (vars[name] ?? m));
}
