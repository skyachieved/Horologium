/*
 * Pixel-sprite characters (owner's note 10: "closer to sprites... moving pixel art, less overall objects"). PURE.
 *
 * A sprite is DATA: a palette and, per state, 1-6 frames of ASCII rows ('.' = transparent, every other character
 * a palette key). Agents and people can edit a frame as text. The shell turns it into crisp SVG: one group per
 * state, one group per frame, and a CSS step animation that shows each frame in its slot (the widget's state
 * classes pick the visible state, and calm mode pauses the steps like any other animation).
 */
export const SPRITE_STATES = Object.freeze(['idle', 'wave', 'cheer', 'sleep']);
export const MAX_FRAMES = 6;
const DEFAULT_FPS = Object.freeze({ idle: 3, wave: 6, cheer: 6, sleep: 1.5 });

/** Semantic checks the JSON schema cannot express. Returns a list of problems (empty = fine). */
export function checkSprite(sprite) {
  const problems = [];
  const [w, h] = sprite.size;
  for (const key of Object.keys(sprite.palette)) {
    if (key.length !== 1 || key === '.' || key === ' ') problems.push(`palette key "${key}" must be one character other than "." or a space`);
  }
  if (!sprite.frames.idle?.length) problems.push('frames.idle needs at least one frame');
  for (const [state, frames] of Object.entries(sprite.frames)) {
    if (!SPRITE_STATES.includes(state)) problems.push(`frames.${state}: unknown state (use ${SPRITE_STATES.join(', ')})`);
    frames.forEach((rows, i) => {
      if (rows.length !== h) problems.push(`frames.${state}[${i}]: ${rows.length} rows, expected ${h}`);
      rows.forEach((row, y) => {
        if (row.length !== w) problems.push(`frames.${state}[${i}] row ${y}: ${row.length} columns, expected ${w}`);
        for (const ch of row) if (ch !== '.' && !(ch in sprite.palette)) problems.push(`frames.${state}[${i}] row ${y}: "${ch}" is not in the palette`);
      });
    });
  }
  return [...new Set(problems)];
}

/** One row of pixels as rects, merging runs of the same colour (a 16x16 frame becomes ~40 rects, not 256). */
function rects(rows, palette) {
  let out = '';
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.') { x += 1; continue; }
      let end = x + 1;
      while (end < row.length && row[end] === ch) end += 1;
      out += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${palette[ch]}"/>`;
      x = end;
    }
  });
  return out;
}

/**
 * SVG markup for a sprite. Missing states fall back to idle. Each frame of an n-frame state is visible for 1/n of
 * the cycle (keyframes hz-sprite-n in base.css); its delay puts it in its slot.
 */
export function spriteSvg(sprite) {
  const [w, h] = sprite.size;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" class="sprite">`];
  for (const state of SPRITE_STATES) {
    const frames = sprite.frames[state]?.length ? sprite.frames[state] : sprite.frames.idle;
    const n = Math.min(frames.length, MAX_FRAMES);
    const cycle = n / (sprite.fps?.[state] ?? DEFAULT_FPS[state]);
    out.push(`<g class="sprite-state" data-state="${state}">`);
    for (let i = 0; i < n; i += 1) {
      const style = n > 1 ? ` style="animation: hz-sprite-${n} ${cycle.toFixed(3)}s steps(1, end) ${((i * cycle) / n).toFixed(3)}s infinite"` : '';
      out.push(`<g class="sprite-frame${n === 1 ? ' solo' : ''}"${style}>${rects(frames[i], sprite.palette)}</g>`);
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('');
}
