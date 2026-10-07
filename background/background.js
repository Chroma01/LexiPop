const DEFAULT_HISTORY_SETTING = { enabled: true };
const MAX_DEFINITIONS = 5;
const PRIMARY_TIMEOUT_MS = 4000;
const FALLBACK_TIMEOUT_MS = 6000;
// Primary gets a PRIMARY_PRIORITY_MS headstart as its answers are more complete
const PRIMARY_PRIORITY_MS = 800;

const ACTIVE_REQUESTS = new Map();

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type === "cancel") {
    ACTIVE_REQUESTS.get(request.requestId)?.();
    ACTIVE_REQUESTS.delete(request.requestId);
    return;
  }

  const { word, lang, requestId } = request || {};
  const term = (word || "").trim();
  if (!term) {
    sendResponse({ content: null });
    return true;
  }

  const langNorm = (lang || "en").toLowerCase();

  const controllers = {};
  if (requestId) {
    ACTIVE_REQUESTS.set(requestId, () => {
      controllers.primary?.abort();
      controllers.fallback?.abort();
    });
  }

  const primary = () => {
    if (!langNorm.startsWith("en")) return Promise.resolve(null);
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`;
    // dictionaryapi.dev's origin occasionally stalls (Cloudflare 522) without
    // ever rejecting the fetch
    const controller = new AbortController();
    controllers.primary = controller;
    const timer = setTimeout(() => controller.abort(), PRIMARY_TIMEOUT_MS);
    return fetch(url, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.resolve(null)))
      .then((json) => parseDictionaryApiResponse(json, term))
      .catch(() => null)
      .finally(() => clearTimeout(timer));
  };

  const fallback = () => {
    console.log("Falling back to Wiktionary lookup");
    const controller = new AbortController();
    controllers.fallback = controller;
    const timer = setTimeout(() => controller.abort(), FALLBACK_TIMEOUT_MS);
    // Wiktionary titles are case-sensitive and most lemmas are
    // lowercase, so try the term as typed first (keeps proper nouns like
    // "London" working), then with the first letter lowercased
    // ("Official" -> "official").
    const candidates = [term];
    const lowered = term.charAt(0).toLowerCase() + term.slice(1);
    if (lowered !== term) candidates.push(lowered);
    const run = (async () => {
      for (const candidate of candidates) {
        const url = `https://en.wiktionary.org/wiki/${encodeURIComponent(candidate)}`;
        try {
          const r = await fetch(url, { signal: controller.signal });
          if (!r.ok) continue;
          const html = await r.text();
          const content = parseWiktionary(html, term);
          if (content) return content;
        } catch {
          if (controller.signal.aborted) return null;
        }
      }
      return null;
    })();
    return run.finally(() => clearTimeout(timer));
  };

  const resolveContent = () => {
    const primaryPromise = primary();

    let fireFallback;
    const headstart = new Promise((resolve) => {
      const timer = setTimeout(resolve, PRIMARY_PRIORITY_MS);
      fireFallback = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    primaryPromise.then((content) => {
      if (!content) fireFallback();
    });
    const fallbackPromise = headstart.then(fallback);

    return Promise.race([
      primaryPromise.then((content) => ({ source: "primary", content })),
      fallbackPromise.then((content) => ({ source: "fallback", content })),
    ]).then((first) => {
      // Whichever answers first wins, unless it came back empty, then wait
      // for the other one.
      if (first.content) return first.content;
      return first.source === "primary" ? fallbackPromise : primaryPromise;
    });
  };

  resolveContent()
    .then((content) => {
      sendResponse({ content });
      if (requestId) ACTIVE_REQUESTS.delete(requestId);

      if (content) {
        browser.storage.local.get().then((results) => {
          const history = results.history || DEFAULT_HISTORY_SETTING;
          if (history.enabled) return saveWord(content);
        });
      }
    })
    .catch(() => {
      sendResponse({ content: null });
      if (requestId) ACTIVE_REQUESTS.delete(requestId);
    });

  return true;
});

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Parse an English Wiktionary page. Wiktionary is used as the fallback
 * dictionary: unlike search-engine dictionary cards it renders a stable,
 * semantic HTML structure (Wikimedia markup) for essentially every English
 * word, and provides IPA transcriptions, pronunciation audio, and
 * part-of-speech-grouped definitions.
 *
 * The word's English section runs from the "English" h2 to the next h2;
 * inside it, part-of-speech headings appear at either the h3 or the h4
 * level (words with multiple etymologies nest them under an
 * "Etymology N" subsection), so both levels are considered. Returns the
 * popup content shape, or null if no definitions are present.
 */
function parseWiktionary(html, term) {
  const engOpen = html.indexOf('id="English"');
  if (engOpen === -1) return null;
  // Start at the opening <div> of the "English" heading container.
  const start = html.lastIndexOf("<div", engOpen);
  const afterTag = html.indexOf(">", engOpen) + 1;
  const nextH2 = html.indexOf("<h2", afterTag);
  const englishHtml =
    nextH2 === -1 ? html.slice(start) : html.slice(start, nextH2);

  // Re-parse the section into a detached document for querySelector.
  // (DOMParser instead of a dynamic innerHTML assignment, which the
  // addons linter flags as unsafe.)
  const container = new DOMParser().parseFromString(
    englishHtml,
    "text/html",
  ).body;

  // First IPA transcription in the section.
  const phoneticText =
    (container.querySelector("span.IPA") || {}).textContent?.trim() || null;

  // First recorded pronunciation; protocol-relative URLs are made absolute.
  let audioSrc = null;
  const srcEl = container.querySelector('source[src*="upload.wikimedia"]');
  if (srcEl) {
    const src = srcEl.getAttribute("src");
    if (src) audioSrc = src.replace(/^\/\//, "https://");
  }

  // Part-of-speech heading titles, at either nesting level.
  const POS = new Set([
    "Noun",
    "Proper noun",
    "Verb",
    "Adjective",
    "Adverb",
    "Pronoun",
    "Determiner",
    "Preposition",
    "Postposition",
    "Conjunction",
    "Interjection",
    "Article",
    "Numeral",
    "Prefix",
    "Suffix",
    "Root",
    "Exclamation",
  ]);

  const meanings = [];
  for (const heading of container.querySelectorAll(".mw-heading")) {
    const h = heading.querySelector("h2, h3, h4");
    if (!h) continue;
    const partOfSpeech = h.textContent.trim();
    if (!POS.has(partOfSpeech)) continue;

    // The section body is the run of siblings up to the next heading.
    let sib = heading.nextElementSibling;
    const wrap = document.createElement("div");
    while (sib && !sib.classList.contains("mw-heading")) {
      wrap.appendChild(sib.cloneNode(true));
      sib = sib.nextElementSibling;
    }

    const list = wrap.querySelector("ol") || wrap.querySelector("ul");
    if (!list) continue;

    for (const li of list.children) {
      if (li.tagName !== "LI") continue;
      const exDiv = li.querySelector(".h-usage-example");
      const example = exDiv
        ? exDiv.textContent.replace(/\s+/g, " ").trim()
        : null;
      // Nested <dl>s carry examples/synonyms/translations and nested
      // <ul>s carry citations (source + quotation blocks); neither is
      // part of the definition itself.
      const clone = li.cloneNode(true);
      clone.querySelectorAll("dl, ul").forEach((el) => el.remove());
      const definition = clone.textContent.replace(/\s+/g, " ").trim();
      if (!definition) continue;
      meanings.push({
        partOfSpeech,
        definition: capitalize(definition),
        example,
      });
      if (meanings.length >= MAX_DEFINITIONS) break;
    }
    if (meanings.length >= MAX_DEFINITIONS) break;
  }
  if (!meanings.length) return null;

  return { word: term, phoneticText, audioSrc, meanings };
}

/**
 * Collect up to MAX_DEFINITIONS definitions across all entries of a
 * dictionaryapi.dev response, preserving part of speech and example.
 */
function collectMeanings(entries) {
  return entries
    .flatMap((entry) =>
      (entry.meanings ?? []).flatMap((meaning) =>
        (meaning.definitions ?? [])
          .filter((definition) => definition.definition)
          .map((definition) => ({
            partOfSpeech: meaning.partOfSpeech || "",
            definition: capitalize(definition.definition),
            example: definition.example || null,
          })),
      ),
    )
    .slice(0, MAX_DEFINITIONS);
}

/**
 * Find the first phonetic transcription and audio recording in the entries
 * of a dictionaryapi.dev response.
 */
function findPhonetics(entries) {
  let phoneticText = null;
  let audioSrc = null;
  for (const entry of entries) {
    const phon = (entry.phonetics || []).find((p) => p.audio || p.text) || {};
    phoneticText ||= phon.text || entry.phonetic || null;
    audioSrc ||= phon.audio || null;
    if (phoneticText && audioSrc) {
      break;
    }
  }
  return { phoneticText, audioSrc };
}

/**
 * Convert a dictionaryapi.dev response into the popup content shape,
 * or null if it contains no usable definitions.
 */
function parseDictionaryApiResponse(json, term) {
  if (!Array.isArray(json) || !json.length) {
    return null;
  }

  const meanings = collectMeanings(json);
  if (!meanings.length) {
    return null;
  }

  return {
    word: json[0].word || term,
    ...findPhonetics(json),
    meanings,
  };
}

function saveWord(content) {
  return browser.storage.local.get("definitions").then((results) => {
    const definitions = results.definitions || {};
    definitions[content.word] = content.meanings
      .map((m) => (m.partOfSpeech ? `(${m.partOfSpeech}) ` : "") + m.definition)
      .join("\n");
    return browser.storage.local.set({ definitions });
  });
}
