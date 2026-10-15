#!/usr/bin/env node
/*
 * Generates assets/icon.png (512px, installer/app icon) and assets/tray.png + tray@2x.png.
 * A tomato (focus) with a small water-drop badge (hydration). Pure Node: rasterizes with 4x4
 * supersampling and encodes PNG with zlib, so no image dependency is needed.
 * Run: node tools/make-icons.js   (outputs are committed; re-run only to change the design)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

const inEllipse = (u, v, cx, cy, rx, ry) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1;
function inRotatedEllipse(u, v, cx, cy, rx, ry, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const du = u - cx;
  const dv = v - cy;
  return inEllipse(du * c + dv * s, -du * s + dv * c, 0, 0, rx, ry);
}

const RED_LIGHT = rgb('#ff8a7a');
const RED_DARK = rgb('#e2392d');
const LEAF = rgb('#5cc46f');
const LEAF_DARK = rgb('#3a9d52');
const DROP_LIGHT = rgb('#8fd8ff');
const DROP_DARK = rgb('#2f8fe0');

/** Color + coverage at normalized (u, v), or null for transparent. Back to front. */
function shade(u, v) {
  let out = null;

  // tomato body
  if (inEllipse(u, v, 0.46, 0.57, 0.38, 0.34)) {
    const t = Math.min(1, Math.max(0, ((u - 0.2) + (v - 0.3)) / 0.9));
    out = mix(RED_LIGHT, RED_DARK, t);
  }
  // soft highlight
  if (out && inRotatedEllipse(u, v, 0.32, 0.47, 0.08, 0.045, -0.6)) out = mix(out, [255, 255, 255], 0.55);

  // leaf crown
  for (let i = 0; i < 5; i += 1) {
    const a = ((-160 + i * 35) * Math.PI) / 180;
    if (inRotatedEllipse(u, v, 0.46 + 0.075 * Math.cos(a), 0.27 + 0.05 * Math.sin(a), 0.1, 0.034, a)) out = mix(LEAF, LEAF_DARK, i / 5);
  }
  // stem
  if (u > 0.445 && u < 0.475 && v > 0.12 && v < 0.27) out = LEAF_DARK;

  // water-drop badge (bottom right): circle + pointed top
  const dcx = 0.77;
  const dcy = 0.77;
  const dr = 0.14;
  const inCircle = inEllipse(u, v, dcx, dcy + 0.02, dr, dr);
  const inPoint = v >= dcy - 0.2 && v <= dcy + 0.02 && Math.abs(u - dcx) <= ((v - (dcy - 0.2)) / 0.22) * dr;
  if (inCircle || inPoint) {
    out = mix(DROP_LIGHT, DROP_DARK, Math.min(1, Math.max(0, (v - 0.57) / 0.34)));
    if (inEllipse(u, v, dcx - 0.05, dcy + 0.02, 0.025, 0.05)) out = mix(out, [255, 255, 255], 0.6);
  }
  return out;
}

function render(size) {
  const ss = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const c = shade((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            hits += 1;
          }
        }
      }
      const o = (y * size + x) * 4;
      if (hits) {
        buf[o] = Math.round(r / hits);
        buf[o + 1] = Math.round(g / hits);
        buf[o + 2] = Math.round(b / hits);
        buf[o + 3] = Math.round((hits / (ss * ss)) * 255);
      }
    }
  }
  return buf;
}

// ---- minimal PNG encoder ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(root, 'assets');
fs.mkdirSync(outDir, { recursive: true });
for (const [name, size] of [['icon.png', 512], ['tray.png', 32], ['tray@2x.png', 64]]) {
  fs.writeFileSync(path.join(outDir, name), encodePng(size, render(size)));
  console.log(`wrote assets/${name} (${size}x${size})`);
}
