# LexiPop

LexiPop is an instant, in-browser dictionary for Firefox.
Whenever you come across an unfamiliar word online, simply double-click it to see its definitions, pronunciation, and an
option to learn more, without having to leave the page.

This is a personal fork of [Lexigo](https://github.com/jortvanleenen/lexigo) (itself derived from
[Dictionary-Anywhere](https://github.com/meetDeveloper/Dictionary-Anywhere)), kept for my own use after upstream
maintenance stalled: the fallback dictionary source was switched from DuckDuckGo to Brave Search, which is maintained
and stable.

## Installation

Build it from source and load the packaged XPI, or run straight from this repository:

1. In Firefox, open [about:debugging#/runtime/this-firefox](about:debugging#/runtime/this-firefox).
2. Click **Load Temporary Add-on…**: point it at this repository folder, or at the XPI from `web-ext-artifacts/`.

For a permanent install, build the XPI (`npm run build`) and load it via about:addons; for development, `npm run dev`
launches Firefox with the extension and auto-reloads on save.

## Features

- **Instant lookups**: double-click any word to get a popup with up to five definitions, grouped by part of speech,
  with example sentences where available.
- **Pronunciation**: phonetic transcription plus a speaker icon that plays a recorded pronunciation, falling back to
  your browser's text-to-speech when no recording exists.
- **Nested lookups**: double-click a word _inside_ a popup to look that up too.
- **Trigger key**: optionally require holding Ctrl, Alt, or Shift (Command on macOS) while double-clicking, so popups
  only appear when you want them.
- **Word history**: optionally store every word you look up, view the count in the options page, and export it as CSV.
- **Learn more**: every popup links to a full Brave Search for the word.
- **Dark mode**: the popup and options page follow your system color scheme.

## Usage

1. Double-click a word on any page (holding your configured trigger key, if set).
2. Click the speaker icon to hear the word, or "Learn more »" for a full search.
3. Click anywhere outside the popup, or its × button, to dismiss it.

Settings live under the extension's options page (Add-ons Manager → LexiPop → Preferences): language, trigger key, and
word history (including CSV download and clearing).

## How it works

Definitions come from the free [Dictionary API](https://dictionaryapi.dev/) as the primary source, with a
[Brave Search](https://search.brave.com/) fallback for words it doesn't know — Brave's server-rendered "define"
dictionary card provides the word, phonetics, pronunciation audio, and part-of-speech groupings. Both lookups run
in parallel and the first complete answer wins. Requests are sent only to those services, and only when you trigger
them; the extension collects no data (word history is stored locally in your browser and never leaves it).

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
npm run build        # runs vendor, then packages web-ext-artifacts/lexipop-3.0.0.zip
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

This add-on is signed via AMO *self-distribution* (unlisted). Publishing a new version:

1. Bump `version` in `manifest.json` (and `web-ext.config.mjs` output if needed).
2. `npm run build` → `web-ext-artifacts/lexipop-<ver>.zip`.
3. Submit that zip in the AMO Developer Hub (same add-on → new version → "On your own").
4. When it is signed, download the signed `.xpi` from the Developer Hub.
5. Create GitHub release `v<ver>` and upload the **signed** `.xpi` as `lexipop-<ver>.xpi`.
6. Point `update.json` at the new release asset and push — Firefox picks the update up automatically.

Signed releases live in the GitHub Releases section; the current signed
3.0.0 build is the v3.0.0 release asset.
