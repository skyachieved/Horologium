/*
 * Updates (owner's note 12: "detect changes and notify, so all they have to do is press Update"). PURE: no
 * network, no Electron, no clock reads. How an update is applied depends on how Horologium was installed:
 *
 *   install   the Windows installer and the Linux AppImage replace themselves (electron-updater, sha512-checked)
 *   download  macOS (an unsigned app cannot update itself) and the .deb: open the release page
 *   source    a git clone started with `npm start`: show the two commands
 */

export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
export const FIRST_CHECK_DELAY_MS = 15 * 1000;
export const SOURCE_COMMAND = 'git pull && npm install';

/** "v1.2.3" / "1.2.3-beta.1" -> { major, minor, patch, pre } (null when it is not a version). */
export function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(text ?? '').trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? null } : null;
}

/** -1, 0 or 1. A pre-release sorts before its release (1.0.0-beta < 1.0.0); identifiers compare as in semver. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`not a version: "${!x ? a : b}"`);
  for (const key of ['major', 'minor', 'patch']) if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  const xs = x.pre.split('.');
  const ys = y.pre.split('.');
  for (let i = 0; i < Math.max(xs.length, ys.length); i += 1) {
    if (xs[i] === undefined) return -1;
    if (ys[i] === undefined) return 1;
    const xn = /^\d+$/.test(xs[i]);
    const yn = /^\d+$/.test(ys[i]);
    if (xn && yn && Number(xs[i]) !== Number(ys[i])) return Number(xs[i]) < Number(ys[i]) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    if (xs[i] !== ys[i]) return xs[i] < ys[i] ? -1 : 1;
  }
  return 0;
}

/** True only for a well-formed version newer than `current` (garbage from the network is never "newer"). */
export function isNewer(latest, current) {
  if (!parseVersion(latest) || !parseVersion(current)) return false;
  return compareVersions(latest, current) > 0;
}

/** Which of the three routes applies to this copy of the app. */
export function updateRoute({ packaged, platform, appImage = false }) {
  if (!packaged) return 'source';
  if (platform === 'win32') return 'install';
  if (platform === 'linux' && appImage) return 'install';
  return 'download';
}

/** Automatic checks run when enabled and at most once per interval; a manual check always runs. */
export function shouldCheck({ enabled, manual = false, lastCheckedAt = null, now }) {
  if (manual) return true;
  if (!enabled) return false;
  return lastCheckedAt === null || now - lastCheckedAt >= CHECK_EVERY_MS - 60 * 1000;
}

/** The OS notification is shown once per new version, not on every check. */
export const shouldNotify = ({ latest, notifiedVersion }) => Boolean(latest) && latest !== notifiedVersion;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/**
 * Release notes arrive as Markdown (GitHub API) or HTML (electron-updater reads the releases feed). The News tab
 * shows them as plain text lines, never as markup: tags and Markdown markers are stripped, entities decoded.
 */
export function notesToText(raw, { maxLines = 60, maxLength = 300 } = {}) {
  const text = String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/<\s*(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#39|amp|lt|gt|quot|apos|nbsp);/g, (_m, name) => ENTITIES[name]);
  const lines = [];
  for (let line of text.split('\n')) {
    line = line
      .replace(/^\s{0,3}#{1,6}\s+/, '')         // headings
      .replace(/^\s*[-*+]\s+/, '• ')            // bullets
      .replace(/\*\*([^*]+)\*\*/g, '$1')       // bold
      .replace(/`([^`]+)`/g, '$1')               // code
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links keep their text
      .trim();
    if (!line && (!lines.length || lines.at(-1) === '')) continue; // no leading or doubled blank lines
    lines.push(line.slice(0, maxLength));
    if (lines.length >= maxLines) break;
  }
  while (lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * The News bubble shows a dot until News has been opened on this version. `seen` is the version it was last opened
 * on; null means never (a fresh install marks the current version as seen, so only upgrades get the dot).
 */
export const hasUnseenNews = ({ seen, current }) => !seen || isNewer(current, seen);
