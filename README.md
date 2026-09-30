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

## Development

Prerequisites: Node.js and Firefox.

```bash
npm install        # install dev tooling (ESLint, Prettier, web-ext)
npm run dev        # launch Firefox with the extension, auto-reloading on save
npm run build      # package the extension into web-ext-artifacts/
```

Quality checks:

```bash
npm run lint       # ESLint with auto-fix (lint:check to only report)
npm run format     # Prettier write (format:check to only report)
npm run lint:ext   # addons-linter, the same validation AMO runs on submission
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

Note: the v3.0.0 release asset is the unsigned placeholder build; replace it with the signed XPI from step 4.
