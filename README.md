# LexiPop

LexiPop is an instant, in-browser dictionary for Firefox.
Whenever you come across an unfamiliar word online, simply double-click it to see its definitions, pronunciation, and an
option to learn more, without having to leave the page.

This is a personal fork of [Lexigo](https://github.com/jortvanleenen/lexigo) (itself derived from
[Dictionary-Anywhere](https://github.com/meetDeveloper/Dictionary-Anywhere)). The original project stopped
receiving updates, so this fork continues its development. The dictionary source was also switched to
[English Wiktionary](https://en.wiktionary.org/), which is maintained and covers essentially every English word.

## Installation

Build it from source and load the packaged XPI, or run straight from this repository:

1. In Firefox, open [about:debugging#/runtime/this-firefox](about:debugging#/runtime/this-firefox).
2. Click **Load Temporary Add-on…**: point it at this repository folder, or at the XPI from `web-ext-artifacts/`.

For a permanent install, build the XPI (`npm run build`) and load it via about:addons; for development, `npm run dev`
launches Firefox with the extension and auto-reloads on save.

## Features

- **Instant lookups**: double-click any word to get a popup with up to five definitions, grouped by part of speech,
  with example sentences where available.
- **Headword resolution**: an inflected form whose Wiktionary page only declares its base form ("ran" → "run")
  shows the base form's entry, with a note naming the declared relationship.
- **Right-click lookup**: select a word and pick "Look up … in LexiPop" in the context menu — same popup, right where
  the word is.
- **Toolbar search**: click the LexiPop toolbar button to open a search box next to the address bar and type any word;
  results appear as you type.
- **Pronunciation**: phonetic transcription plus a speaker icon that plays a recorded pronunciation, falling back to
  your browser's text-to-speech when no recording exists.
- **Nested lookups**: double-click a word _inside_ a popup to look that up too.
- **Trigger key**: optionally require holding Ctrl, Alt, or Shift (Command on macOS) while double-clicking, so popups
  only appear when you want them.
- **Word history**: optionally store every word you look up, view the count in the options page, and export it as CSV.
- **Learn more**: every popup links to the full Wiktionary article for the word.
- **Dark mode**: the popup and options page follow your system color scheme.

## Usage

1. Double-click a word on any page (holding your configured trigger key, if set) — or select a word, right-click and
   choose "Look up … in LexiPop". You can also click the toolbar button and type a word into the search box.
2. Click the speaker icon to hear the word, or "Learn more »" for a full search.
3. Click anywhere outside the popup, or its × button, to dismiss it.

Settings live under the extension's options page (Add-ons Manager → LexiPop → Preferences): language, trigger key, and
word history (including CSV download and clearing).

## How it works

Definitions come from [English Wiktionary](https://en.wiktionary.org/) — a free, collaboratively edited dictionary
(Wikimedia project) whose rendered HTML is stable and semantic, so the parser can reliably extract the word's IPA
transcription, a recorded pronunciation, and part-of-speech-grouped definitions for essentially every English word.
The free [Dictionary API](https://dictionaryapi.dev/) answers the same lookup in parallel: it fills in a missing IPA
transcription or recording, and carries the lookup when Wiktionary has no page for the word. Inflected forms get
their own Wiktionary pages that only declare their base form ("plural of cat", "simple past of run"); when those
declarations outnumber a page's own senses, LexiPop follows the one-hop link the page itself names and shows the
relationship in the popup — no stemming, no guessing, so "training" and "compute" keep their own entries. Requests
are sent only to those services, and only when you trigger them; the extension collects no data (word history is
stored locally in your browser and never leaves it).

## Building from source (reproducible)

This is the exact build that produces the submitted add-on.

**Requirements**

- Node.js `>= 20.19.0` (tested with v26.x) — install from https://nodejs.org or `nvm install 26`
- npm `>= 8.0.0` (bundled with Node.js)
- Firefox (only for `npm run dev`, not for `npm run build`)

**Steps**

```bash
git clone https://github.com/Chroma01/LexiPop.git
cd LexiPop
npm install          # installs devDependencies (web-ext, eslint, prettier, @floating-ui/*)
npm run vendor       # copies the pinned floating-ui 1.8.0 UMD bundles into content/vendor/
npm run build        # runs vendor, then packages web-ext-artifacts/lexipop-3.4.0.zip
```

`npm run build` already invokes the vendor step, so the minimal path is just
`npm install && npm run build`.

**What the build does**

- `scripts/vendor.mjs` copies the pre-built, minified UMD bundles
  `node_modules/@floating-ui/core/dist/floating-ui.core.umd.min.js` and
  `node_modules/@floating-ui/dom/dist/floating-ui.dom.umd.min.js` into
  `content/vendor/`. These are the exact npm-published bundles for the pinned
  versions `@floating-ui/core@1.8.0` and `@floating-ui/dom@1.8.0` (pinned
  without carets in `package.json`). No bundler, no transpilation of our own
  code is involved: `background/background.js`, `content/lexipop.js`,
  `content/popup.html`, `content/popup.css` and `options/options.html` ship
  exactly as written in this repository.
- `web-ext build` (config: `web-ext.config.mjs`) then zips the extension root
  into `web-ext-artifacts/`. It does not transform any source files.

So the only machine-generated files in the add-on are the two floating-ui
UMD bundles, and they are byte-for-byte the files published by the upstream
npm packages — verifiable at any time with `npm install && npm run vendor`
(diffs only ever differ by trailing line-ending style, never by content).

**Verify**

```bash
npm run lint:check   # eslint, no fixes
npm run format:check # prettier
npm run lint:ext     # web-ext lint (addons-linter, same checks as AMO)
```

## Development

```bash
npm run dev   # launch Firefox with the extension, auto-reloading on save
```

## Credits

Original work by meetDeveloper ([Dictionary-Anywhere](https://github.com/meetDeveloper/Dictionary-Anywhere)), continued
by Jort van Leenen ([Lexigo](https://github.com/jortvanleenen/lexigo)). Forked and maintained by Chroma01.

## License

GPLv3 license. See LICENSE file for details.

## Self-distribution & updates

This add-on is signed via AMO _self-distribution_ (unlisted). Publishing a new version:

1. Bump `version` in `manifest.json` (and `web-ext.config.mjs` output if needed).
2. `npm run build` → `web-ext-artifacts/lexipop-<ver>.zip`.
3. Submit that zip in the AMO Developer Hub (same add-on → new version → "On your own").
4. When it is signed, download the signed `.xpi` from the Developer Hub.
5. Create GitHub release `v<ver>` and upload the **signed** `.xpi` as `lexipop-<ver>.xpi`.
6. Point `update.json` at the new release asset and push — Firefox picks the update up automatically.

Signed releases live in the GitHub Releases section; the current signed
build is the v3.4.0 release asset: English Wiktionary became the primary
dictionary source — dictionaryapi.dev answers the same lookup in
parallel, filling missing IPA transcriptions and audio — and inflected
forms whose Wiktionary page only declares their base form ("cats",
"ran") resolve to that headword with the relationship shown in the
popup. v3.3.0 reworked the icon identity: a tile-less book glyph —
royal-gradient cover, dark navy spine, white pages with a faint neutral
edge, gold notched bookmark. No app-style frame, no letter mark; a
single master `icon.svg` renders every size 16–128 with no separate
tiers; the old popup-card sources `icon-bold.svg` and
`icon-bold-16.svg` are deleted.
