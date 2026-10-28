# Extension API (apiVersion 1)

Everything that varies in Horologium is an **extension**: a folder under `extensions/` with a `manifest.json`. Drop a folder in, restart the app, and it appears. The loader (`src/main/extensions.js`) validates every manifest against the strict schemas in `src/core/contracts/index.js`. If an extension is broken, it is skipped and the reason is shown in Settings > System > Extensions; the rest of the app keeps working.

`npm run validate` runs the same loader from the command line. `npm run new -- <type> <id>` scaffolds a valid starting point.

**Strict means strict:** unknown fields are errors. Every `name` needs both `en` and `ko`. A manifest's `id` must equal its folder name (lowercase kebab-case).

## Common fields

| Field | Rule |
|---|---|
| `type` | `theme`, `character`, `music-source`, `station`, `layer`, `music-pack` (plus the library files `progression-bank` and `groove`) |
| `id` | kebab-case, equals the folder name |
| `apiVersion` | `1` |
| `name` | `{ "en": "...", "ko": "..." }` |
| `version` | `major.minor.patch` |
| `license` | SPDX-style string, e.g. `MIT`, `OFL-1.1` |
| `description` | optional `{ en, ko }` |

## Theme: `extensions/themes/<id>/`

```
manifest.json   tokens.css   theme.css   chimes.json   [dialogue.json]   [fonts/]   characters/<id>/...
```

Extra manifest fields: `mode` (`light`|`dark`), `motion` (`bouncy`|`stepped`|`calm`), `tokens`, `styles`, `chimes` (relative paths), optional `dialogue` (the theme's voice, see [Dialogue](#dialogue-dialoguejson)), optional `fonts: [{ family, file, weight? }]`, `defaultCharacter` (must exist in `characters/`), `preview: { bg, accent }` (hex colours for the picker).

**tokens.css must define every token in `REQUIRED_THEME_TOKENS`** (see `src/core/contracts/index.js`): colours (`--bg --surface --surface-2 --ink --ink-soft --line --accent --accent-ink --focus --break-short --break-long --water --water-deep --good --warn`), shape (`--radius --radius-sm --shadow`), fonts (`--font-ui --font-display --font-mono`), motion (`--ease-pop --ease-soft --dur-fast --dur-med --dur-slow`).

**theme.css** holds component styling. The shell sets `data-theme="<id>"` on the root and puts these state classes on the character wrapper `.char`: `state-idle`, `state-wave`, `state-cheer`, `state-sleep`. The theme owns the motion personality of those states (a sprite's frames animate themselves; the theme moves the whole body). The wrapper also carries `data-character="<id>"`, so a character's own `character.css` can scope itself.

**The menu is the character** (owner's notes 2 and 10). Expanded, the widget is the sprite with its tabs as bubbles around it (`.ring .tab`, `.on` = open, positions come from `base.css` by `data-tab`), and below it (above it when the window flips up, `#app[data-flip="up"]`) a speech bubble `.speech` whose tail (`.speech::before`) points at the character. The bubble starts with `.speech-line` (what the character says), then the open tab. Style those in theme.css: `#app[data-mode="expanded"] .speech` for the bubble, `.ring .tab` for the menu bubbles; the theme may redefine `@keyframes hz-pop` (how the bubbles pop out).

**Scenes** (`scenes.pomodoro`, `scenes.hydration`, both required) are inline SVG that the theme styles with CSS. The shell never edits the SVG; it only sets variables and attributes on the wrapper `div.scene`:

| Scene | Variables / attributes the shell sets |
|---|---|
| Pomodoro (`.scene-pomodoro`) | `--progress` 0..1, `--phase-color` (follows `--focus`, `--break-short`, `--break-long`), `data-phase` = `focus`/`short`/`long`, `data-running` = `true`/`false` |
| Hydration (`.scene-hydration`) | `--fill` 0..1 (today's progress), `data-state` = `empty`/`filling`/`full`, `data-level` 0..10 (for discrete stages, e.g. a plant), class `celebrate` for about 1.4 s after a milestone |

Name animatable parts with `data-part`. Tips: `pathLength="100"` on a circle lets CSS drive a ring with percentages (`stroke-dashoffset: calc(100 * (1 - var(--progress)))`); CSS can move SVG parts (`transform: translateY(calc((1 - var(--fill)) * 150px))`) and even reshape paths (`d: path("...")`). Place the time/count text with `.scene-overlay` rules; the HTML overlay holds `.time` + `.phase-label` (Pomodoro) and `.count` + `.count-label` (hydration).

The theme may redefine the `@keyframes` names `hz-enter` and `hz-leave` (pop in / pop out), `hz-bit`, `hz-confetti` and `hz-float` (particles); later stylesheets win, so the theme's definitions override the defaults in `src/renderer/css/base.css`.

**chimes.json** is synthesized sound, no audio files. It must define every event in `CHIME_EVENTS`: `focusEnd`, `breakEnd`, `drinkDue`, `drinkLogged`, `milestone`, `undo`. Each is 1-12 notes `{ at, freq, dur, type, gain }` (seconds, Hz, `sine|triangle|square|sawtooth`, 0-1).

A theme needs at least one valid character.

## Character: `extensions/themes/<theme>/characters/<id>/`

```
manifest.json   sprite.json   [dialogue.json]        (or, older style: character.svg [character.css])
```

Extra fields: exactly one of `sprite` (a pixel sprite, the default since 0.2.0) or `svg` (vector art), optional `css`, optional `dialogue` (the character's own lines, which replace the theme's for the situations it defines), `accent` (hex). A character belongs to the theme whose folder it lives in, because its art style belongs to that theme. `npm run new -- character <id> --theme <theme>` starts from a sprite.

### Sprite (`sprite.json`, `src/core/sprite.js`)

Pixel art as text: one character per pixel, `.` is transparent, every other character is a key of `palette`.

```json
{
  "size": [16, 16],
  "palette": { "o": "#3b2a2a", "b": "#ffd6a5", "p": "#ff9aa2" },
  "fps": { "idle": 2 },
  "frames": {
    "idle":  [ ["................", "...16 rows of 16..."], ["...a second frame..."] ],
    "wave":  [ ... ],
    "cheer": [ ... ],
    "sleep": [ ... ]
  }
}
```

- `size` is `[width, height]`, 8-32 each; every frame has exactly that many rows and columns.
- `frames` has 1-6 frames per state; `idle` is required, a missing state falls back to `idle`. States: `idle`, `wave` (hello, a reminder), `cheer` (a drink, a milestone, a finished session), `sleep` (breaks).
- `fps` per state is optional (defaults: idle 3, wave 6, cheer 6, sleep 1.5).
- The shell renders it as crisp SVG (one `<rect>` per run of same-coloured pixels) and steps through the frames with CSS, so calm mode and reduce motion pause it like any other animation (reduce motion holds the first frame). Data only: nothing in a sprite can run code.

### Dialogue (`dialogue.json`, `src/core/dialogue.js`)

What the character says at the top of the speech bubble, in English and Korean. A theme's `dialogue.json` is its voice; a character's replaces it situation by situation. Every situation is optional (the shell has a generic line for each), each has `en` and `ko` arrays of 1-12 lines of up to 140 characters (aim for 70: the bubble shows two lines).

| Situation | When | Placeholders |
|---|---|---|
| `hello` | the first 30 s after opening the menu | `{time}` the clock |
| `idle` | after that, when nothing is going on | none |
| `focus` | a focus session is running | `{time}` left |
| `break` | a break is running | `{time}` left |
| `drink` | a cup is due | `{done}`, `{total}` cups |
| `cheer` | 8 s after logging a cup | `{done}`, `{total}` |
| `goal` | today's cups are done | `{total}` |
| `setup` | no hydration profile yet | none |

The loader rejects a placeholder the situation does not provide. A line holds for 45 s, so the bubble changes now and then instead of flickering; each logged cup gets its own cheer.

**SVG rules** (characters with `svg`) (`src/core/svg.js`): root `<svg>` with a `viewBox`; no `<script>`, `<foreignObject>`, event-handler attributes, `javascript:` URLs, external `href`/`url()`/`@import`. Name animatable parts with `data-part="body|eyes|mouth|arm-l|arm-r|cheeks|leaf|..."` so the theme's CSS can target them. The svg is injected inline.

## Music source: `extensions/music-sources/<id>/`

Common extra fields: `kind` (`generated`|`files`|`web`), `tab: { order, icon }` (sub-tab position and a short glyph), `capabilities: { volume, mute, seek, playlist }` (the UI only shows controls the source supports).

- `generated` / `files`: also `entry` (a JS module in the folder, bundled extensions only).
- `web`: declarative only.

```json
"web": {
  "sites": [{ "id": "main", "name": { "en": "...", "ko": "..." }, "url": "https://..." }],
  "navAllow": ["example.com", "*.example.com"],
  "partition": "persist:my-service",
  "miniPlayer": "none | video-clip",
  "size": { "w": 960, "h": 640 },
  "notice": { "en": "...", "ko": "..." }
}
```

`url` must be `https`. `navAllow` lists hosts the view may navigate to; everything else opens in the system browser. `miniPlayer: "video-clip"` lets a playing video be pinned into the small always-on-top mini player when the widget is collapsed or hidden (see below); `none` destroys the page instead. The view exists only while its tab is open. **There is intentionally no field for script injection, header or user-agent changes, or ad handling** (see the hard rules in AGENTS.md); do not add one without the owner's explicit approval.

## Locale: `extensions/locales/<code>.json`

```json
{ "_meta": { "code": "ko", "name": "한국어" }, "app.title": "...", "...": "..." }
```

Flat `key -> string`. `_meta.code` equals the file name. Every non-English locale must have exactly the same keys as `en.json` (a test enforces this). User-installed locales (`<userData>/extensions/locales/`) load too, but cannot replace a bundled one.

### The mini player (`miniPlayer: "video-clip"`)

When a video is playing and the widget collapses, hides, or the user leaves the Music tab, the SAME web view moves into a small always-on-top window (`src/main/miniplayer.js`) that shows only the `<video>`: the page is **not modified**. The code reads the video's rectangle (a layout query), scrolls to the top, and changes only the view's zoom and position so the window edge clips everything else (`cropLayout` in `src/core/mini.js`, unit-tested). After 3 s of rest it dims to 35 % opacity (never invisible, so it is never a hidden background player); hovering it, or pressing the show/hide hotkey, brings it back to full opacity. A 22 px strip holds expand and close buttons. If no playing video is found within 15 s, or the source says `none`, the page is destroyed instead.

## Stations (generated music): `extensions/music-sources/generated/`

The Music tab's first sub-tab. **Flow:** genre chips -> station list -> presets -> the station's own sliders -> volume -> play. Everything in that flow is generated from the data below, so adding a genre or station changes no UI code.

```
manifest.json            the music source itself (kind "generated", entry index.js)
categories.json          genre chips: [{ id, name: {en, ko}, order }]   ("custom" = My Stations is built in)
stations/<id>/manifest.json            WHAT PLAYS: one folder per station   <- add new music here
layers/<id>/manifest.json (+ index.js) continuous sounds: noise, rain, vinyl crackle
instruments/<id>.js                    voices: epiano, piano, upright-bass, sub-bass, pad, kits
library/progressions/<id>.json         banks of chord loops
library/grooves/<id>.json              16-step drum/bass/comp rhythm grids
compose/  synth/                       the engine (pure composer; Web Audio synth) - not extension points
```

**Composition is separated from synthesis.** `compose()` (pure, deterministic, unit-tested in plain Node) turns a station's data plus a seed into a *Plan*: plain data, no audio. `renderPlan()` renders a phrase of that Plan with an `OfflineAudioContext`; the engine queues two phrases ahead and starts them back to back on the audio clock. A new genre is therefore mostly JSON.

Scaffold any piece with `npm run new -- <type> <id>`:

| Command | Creates |
|---|---|
| `station <id> --category <genre>` | `stations/<id>/manifest.json` (a working lofi station: copy and change it) |
| `station <id> --user` | the same, in your own `<userData>/extensions/stations/<id>/` under **My Stations** (data only) |
| `category <id> --name "..." --ko "..."` | appends a genre to `categories.json` (a genre needs >= 1 station: a test enforces it) |
| `layer <id> [--kind dsp\|noise] [--color white\|pink\|brown]` | `layers/<id>/` |
| `instrument <id> [--role chords\|bass\|drums\|melody\|pad]` | `instruments/<id>.js` (drums get a kit template) |
| `progression <id>` / `groove <id>` | a file in `library/progressions` / `library/grooves` |

### Station manifest

Common fields plus:

| Field | Meaning |
|---|---|
| `category` | a genre id from `categories.json` (or `custom`) |
| `gainDb` | -24..6. Loudness trim. **Calibrate it** with `npm run test:audio -- --calibrate` so every station sits at about -27 dB (A-weighted) +/- 3 dB; a test enforces the range, the audio QA enforces the loudness |
| `tags` | optional, up to 6 short words |
| `layers` | `[{ id, level 0..1 }]`, **only for sound stations** (no `composer`, e.g. Noise & Nature). A song (a station with a `composer`) must use `[]`, and its presets may not add layers: the loader rejects both (owner's decision: songs play clean) |
| `composer` | optional. No composer = a pure sound station (the noise ones) that needs at least one layer |
| `params` | up to 8 sliders `{ id, type: "slider", label: {en,ko}, min, max, step, default, target }` |
| `presets` | up to 8 named moods `{ id, name: {en,ko}, params?: { <paramId>: value }, layers?: [...] }` (`layers` only on sound stations) |

A slider's `target` says what it drives: `tempo`, `swing`, `lowpassHz`, `reverb`, `wobble`, `saturation`, `melodyDensity`, `drumLevel`, `bassLevel`, `chordLevel`, `melodyLevel`. Stations without a composer may only target `lowpassHz` (the "tone" slider) and `reverb`. Presets may only set declared params, inside their min..max, and only reference existing layers. Changing a composed station's slider restarts it with the same seed after a short crossfade; layer sliders and the noise tone are live.

**`composer`**

| Field | Meaning |
|---|---|
| `tempo` | `[slowest, fastest]` BPM (40..200); each play picks a tempo in range unless a `tempo` slider overrides it |
| `swing` | 0.5 (straight) .. 0.75; 0.667 is a triplet feel |
| `barsPerPhrase` | 4..16 (a phrase is rendered ahead as one unit) |
| `keys` | pool of keys (`C`, `Db`, `F#`, ...); one is picked per play |
| `scales` | `{ major?, minor? }` scale used by the melody voice (`major-pent`, `minor-pent`, `dorian`, `blues`, ...) |
| `progressions` | ids of progression banks to draw chord loops from |
| `groove` | id of a groove |
| `voices` | 1..6 voices, below |
| `fx` | `{ lowpassHz, reverb, wobble, saturation }` master colour: lowpass cutoff, reverb amount, tape wobble, saturation (all 0..1 except the cutoff) |

**Voice** `{ role, instrument, level, ... }`: `role` is `chords | bass | drums | melody | pad`, `instrument` an id from `instruments/`, `level` 0..1.5. Optional per role: `style` (chords: `pad` = held voicing, `stab` = rhythmic hits from the groove's `comp` pattern, `ballad` = long stabs, `arp` = arpeggio; bass: `root-fifth`, `walking`, `sustain`), `velocity` 0..1, `strum` (seconds between chord notes, 0..0.2), `range` (`[lowMidi, highMidi]`), `lo` (lowest bass note), `rootless`, `maxNotes`, `density` (melody, 0..1), `scale`, `pocket` (drum push/pull in beats).

### Layer

`kind: "noise"` + `noise.color` (`white|pink|brown`) needs no code. `kind: "dsp"` + `entry` exports `generate({ sampleRate, seconds? }) -> Float32Array[]` (one array per channel, **seamless**: build `seconds + fade` samples and use `seamless()`; normalize with `normalizeRms` or `normalizePeak` from `synth/noise.js`). Keep it pure so it can be tested in Node. `gainDb` trims its loudness against the other layers.

### Instrument

A module `instruments/<id>.js` (the file name is the id) exporting `meta = { id, roles: [...] }` and `create(ctx, out, params) -> { play({ t, d, n, v }) }`: `t` start (audio-clock seconds), `d` length (s), `n` MIDI note (or a drum voice name for kits), `v` velocity. Connect everything to `out` and stop your own nodes. Drum kits are a spec for `createKit()` in `synth/drums.js` (kick, snare, hat, ohat, rim, clap, snap, brush, ride, shaker). Instruments are lazy-loaded only when a station that uses them plays.

### Progression bank and groove (shared by id, so stations do not copy-paste)

```json
{ "id": "my-loops", "type": "progression-bank",
  "progressions": [{ "name": "ii-V-I", "mode": "major", "chords": [{ "r": "ii", "q": "m7", "beats": 4 }, ...] }] }
```
`r` is a roman numeral (`I`..`VII`, optional `b`/`#`, case ignored); `q` a chord quality (`maj7 m7 7 9 m9 maj9 6 m6 69 m7b5 dim7 sus4 add9 m11 13 ...`, the full list is `CHORD_QUALITY_NAMES` in `contracts/index.js`).

```json
{ "id": "my-groove", "type": "groove",
  "patterns": { "kick": ["x--- --x- x--- ----"], "snare": ["---- x--- ---- x---"], "hat": [...], "bass": [...], "comp": [...] },
  "fills": { "snare": ["---- x--- --o- xoxo"] } }
```
Each pattern is exactly 16 steps (spaces allowed anywhere): `x` hit, `X` accent, `o` ghost, `-` `.` `_` rest. Several variants per pattern are rotated bar by bar; `bass` and `comp` drive the bass and stab voices, everything else is a drum voice.

### Referential integrity

The loader rejects a station that references a missing category, layer, progression bank, groove, or instrument, a preset that sets an undeclared or out-of-range param, or a groove without drum patterns for a drums voice. User stations (`<userData>/extensions/stations/<id>/`) are data only, must use category `custom`, and may reference any bundled building block.

## My music: `extensions/music-sources/local-files/` and music packs

The **My music** sub-tab plays audio files the user chooses (a folder picker; only file *names* are read, nothing is uploaded, copied or tag-parsed) and **music packs**. Playback is a plain `<audio>` element routed through the shared music bus, so the music/master volume and mute apply; OS media keys work through the Media Session API. Supported: mp3, ogg/oga/opus, flac, wav, m4a, aac, weba.

Files are served to the page by the custom protocol at `horologium://app/media/<folder id>/<path>` (audio types only, path-traversal checked, **range-aware** so seeking and duration work: `src/main/media-serve.js`).

A **music pack** is a data-only folder: `<userData>/extensions/music-packs/<id>/manifest.json` plus audio files. This is the path for AI-generated or purchased tracks you made elsewhere (for example with ACE-Step); the repo itself ships none.

```json
{ "type": "music-pack", "id": "rainy-ai-set", "apiVersion": 1,
  "name": { "en": "Rainy AI set", "ko": "비 오는 날 AI 모음" }, "version": "1.0.0",
  "license": "CC0-1.0", "provenance": "Generated with ACE-Step on my own machine, 2026-09",
  "tracks": [{ "file": "tracks/01 Night Drive.mp3", "title": "Night Drive" }] }
```
`license` and `provenance` are optional: without **both**, the pack plays but is labelled "unverified license". Track paths are relative with forward slashes: no leading `/`, no drive letter, no `..`, no backslash. Files must exist and be audio (each <= 400 MB). Broken packs are skipped with a reason in Settings > System > Extensions.
