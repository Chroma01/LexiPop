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
    console.log("Falling back to DDG lookup");
    const url = `https://noai.duckduckgo.com/js/spice/dictionary/definition/${encodeURIComponent(term.toLowerCase())}/h1`;
    const controller = new AbortController();
    controllers.fallback = controller;
    const timer = setTimeout(() => controller.abort(), FALLBACK_TIMEOUT_MS);
    return fetch(url, { signal: controller.signal })
      .then((r) => r.text())
      .then((body) => {
        const match = body.match(
          /^\s*ddg_spice_dictionary_definition\(([\s\S]*)\);\s*$/,
        );
        if (!match || !match[1].trim()) return null;

        const entries = JSON.parse(match[1]);
        if (!Array.isArray(entries) || !entries.length) return null;

        const meanings = [];
        for (const entry of entries) {
          if (!entry.text) continue;
          meanings.push({
            partOfSpeech: entry.partOfSpeech || "",
            definition: capitalize(stripHtml(entry.text)),
            example: stripHtml(entry.exampleUses?.[0]?.text || "") || null,
          });
          if (meanings.length >= MAX_DEFINITIONS) break;
        }
        if (!meanings.length) return null;

        return {
          word: entries[0].word || term,
          phoneticText: null,
          audioSrc: null,
          meanings,
        };
      })
      .catch(() => null)
      .finally(() => clearTimeout(timer));
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

function stripHtml(text) {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) =>
      ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[entity],
    )
    .replace(/\s+/g, " ")
    .trim();
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
