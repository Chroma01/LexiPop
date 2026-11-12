const DEFAULT_HISTORY_SETTING = { enabled: true };
const MAX_DEFINITIONS = 5;
const WIKTIONARY_TIMEOUT_MS = 6000;
const API_TIMEOUT_MS = 4000;
// Wiktionary is the primary source: Wikimedia hosting, curated entries, and
// recorded pronunciations on the page itself. dictionaryapi.dev answers the
// same lookup in parallel; its role is to fill in a missing IPA
// transcription or recording and to carry the lookup when Wiktionary misses
// entirely. On its bad days (Cloudflare 522 stalls) the merge waits at most
// AUDIO_MERGE_MS past the Wiktionary answer.
const AUDIO_MERGE_MS = 1500;

const ACTIVE_REQUESTS = new Map();

// Selection context menu: a right-clicked word is looked up through the
// content script, opening the same in-page popup as a double-click.
const LOOKUP_MENU_ID = "lexipop-lookup";
browser.contextMenus.removeAll().then(() =>
  browser.contextMenus.create({
    id: LOOKUP_MENU_ID,
    title: "Look up “%s” in LexiPop",
    contexts: ["selection"],
  }),
);

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== LOOKUP_MENU_ID || !tab?.id) {
    return;
  }
  const word = (info.selectionText || "").trim();
  if (word.length <= 1) {
    return;
  }
  browser.tabs
    .sendMessage(tab.id, { type: "contextLookup", word, x: info.x, y: info.y })
    .catch(() => {});
});

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
      controllers.api?.abort();
      controllers.wiktionary?.abort();
    });
  }

  const apiLookup = () => {
    if (!langNorm.startsWith("en")) return Promise.resolve(null);
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`;
    // dictionaryapi.dev's origin occasionally stalls (Cloudflare 522) without
    // ever rejecting the fetch
    const controller = new AbortController();
    controllers.api = controller;
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    return fetch(url, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.resolve(null)))
      .then((json) => parseDictionaryApiResponse(json, term))
      .catch(() => null)
      .finally(() => clearTimeout(timer));
  };

  const wiktionaryLookup = () => {
    const controller = new AbortController();
    controllers.wiktionary = controller;
    const timer = setTimeout(() => controller.abort(), WIKTIONARY_TIMEOUT_MS);
    // Wiktionary titles are case-sensitive and most lemmas are
    // lowercase, so try the term as typed first (keeps proper nouns like
    // "London" working), then with the first letter lowercased
    // ("Official" -> "official").
    const candidates = [term];
    const lowered = term.charAt(0).toLowerCase() + term.slice(1);
    if (lowered !== term) candidates.push(lowered);

    const fetchParse = async (title) => {
      const url = `https://en.wiktionary.org/wiki/${encodeURIComponent(title)}`;
      try {
        const r = await fetch(url, { signal: controller.signal });
        if (!r.ok) return null;
        return parseWiktionary(await r.text(), term);
      } catch {
        return null;
      }
    };

    const run = (async () => {
      for (const candidate of candidates) {
        const content = await fetchParse(candidate);
        if (!content) continue;
        if (controller.signal.aborted) return null;

        // Inflected forms get their own Wiktionary pages that only declare
        // the form ("plural of cat", "simple past of run") instead of
        // defining it. When those declarations outnumber the page's real
        // senses, follow the headword the page itself names: one hop, no
        // stemming, no guessing.
        const pointer = headwordPointer(content);
        if (!pointer || pointer.target === candidate) return content;
        const target = await fetchParse(pointer.target);
        if (!target) return content;
        target.word = pointer.target;
        target.resolved = { from: term, via: pointer.text };
        return target;
      }
      return null;
    })();
    return run.finally(() => clearTimeout(timer));
  };

  const resolveContent = async () => {
    const apiPromise = apiLookup();
    const content = await wiktionaryLookup();
    if (!content) return apiPromise;
    if (!content.phoneticText || !content.audioSrc) {
      const api = await Promise.race([
        apiPromise,
        new Promise((resolve) =>
          setTimeout(() => resolve(null), AUDIO_MERGE_MS),
        ),
      ]);
      if (api) {
        content.phoneticText ||= api.phoneticText;
        content.audioSrc ||= api.audioSrc;
      }
    }
    return content;
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

/**
 * Wiktionary declares inflected forms with lines assembled from fixed
 * grammar terms: "Plural of cat", "Third-person singular simple present
 * indicative of cat", "Simple past of run". A definition is a pointer
 * when every word before " of " is such a term; qualifiers like
 * "(nonstandard, colloquial)" or ordinary sentence words break the chain,
 * so real definitions are never mistaken for pointers. The headword is
 * read from the declaration itself instead of guessed by a stemmer:
 * "king" is never stripped to "kin".
 */
const POINTER_TERMS = new Set([
  "the",
  "first",
  "second",
  "third",
  "person",
  "singular",
  "plural",
  "simple",
  "past",
  "present",
  "continuous",
  "perfect",
  "progressive",
  "indicative",
  "subjunctive",
  "conditional",
  "imperative",
  "infinitive",
  "participle",
  "gerund",
  "comparative",
  "superlative",
  "more",
  "most",
  "alternative",
  "obsolete",
  "archaic",
  "dated",
  "historical",
  "misspelling",
  "capitalization",
  "capitalisation",
  "hyphenation",
  "form",
  "forms",
  "spelling",
  "spellings",
  "degree",
  "orthography",
]);

function pointerTarget(definition) {
  // Leading "(nonstandard, colloquial)"-style qualifiers decorate pointer
  // lines too; they are stripped before the grammar-term check.
  const bare = definition.replace(/^(?:\s*\([^)]*\)\s*)+/, "");
  const match = bare.match(/(.*?)\sof\s+(.+)/i);
  if (!match) return null;
  const terms = match[1]
    .toLowerCase()
    .split(/[\s,-]+/)
    .filter(Boolean);
  if (!terms.length || !terms.every((term) => POINTER_TERMS.has(term))) {
    return null;
  }
  const target = match[2].trim().replace(/[.!]+$/, "");
  return target.length && target.length <= 40 ? target : null;
}

/**
 * A page is resolved to its headword only when pointer declarations
 * outnumber real senses. "dogs" (one pointer, four slang senses) and
 * "training" (one pointer, its own noun senses) keep their own pages,
 * while "ran" (three pointers, one obscure nautical sense) follows "run".
 */
function headwordPointer(content) {
  let pointers = 0;
  let target = null;
  let firstPointerText = null;
  for (const { definition } of content.meanings) {
    const captured = pointerTarget(definition);
    if (!captured) continue;
    pointers++;
    target ||= captured;
    firstPointerText ||= definition;
  }
  if (!target || pointers * 2 <= content.meanings.length) return null;
  // Definitions are capitalized by the parser; pointer terms are lowercase.
  return {
    target,
    text: firstPointerText.charAt(0).toLowerCase() + firstPointerText.slice(1),
  };
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Flatten one sense list into {text, example} entries. An entry that
 * introduces a nested list ("Of or having a pole or polarity, as:")
 * keeps its own text, and its nested field-specific senses
 * ("(geography) Of, relating to...") become separate entries instead of
 * merging into one unreadable wall (the "polar" adjective has six of
 * them under a single list item). Quotations (dl/ul) and template
 * styling stay stripped; the inline usage example is returned in its
 * own field rather than repeated inside the definition text.
 */
function flattenSenses(listEl) {
  const out = [];
  for (const li of Array.from(listEl.children)) {
    if (li.tagName !== "LI") continue;
    const clone = li.cloneNode(true);
    clone
      .querySelectorAll("dl, ul, style, script")
      .forEach((el) => el.remove());
    const exDiv = clone.querySelector(".h-usage-example");
    const example = exDiv
      ? exDiv.textContent.replace(/\s+/g, " ").trim()
      : null;
    clone.querySelectorAll(".h-usage-example").forEach((el) => el.remove());
    const nested = Array.from(clone.querySelectorAll(":scope > ol"));
    nested.forEach((el) => el.remove());
    const text = clone.textContent.replace(/\s+/g, " ").trim();
    if (text) out.push({ text, example });
    for (const ol of nested) out.push(...flattenSenses(ol));
  }
  return out;
}

/**
 * Parse an English Wiktionary page. Wiktionary is the primary dictionary:
 * unlike search-engine dictionary cards it renders a stable,
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

    const senses = flattenSenses(list);
    for (const sense of senses) {
      if (meanings.length >= MAX_DEFINITIONS) break;
      meanings.push({
        partOfSpeech,
        definition: capitalize(sense.text),
        example: sense.example,
      });
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
