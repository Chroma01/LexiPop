const DEBOUNCE_MS = 400;
const STATUS_UPDATE_DELAY_MS = 2000;

const searchEl = document.getElementById("search");
const resultEl = document.getElementById("result");
const headingEl = resultEl.querySelector(".heading");
const pronunciationEl = resultEl.querySelector(".pronunciation");
const statusEl = resultEl.querySelector(".status");
const definitionsEl = resultEl.querySelector(".definitions");
const moreInfoEl = resultEl.querySelector(".learn-more");
const audioEl = resultEl.querySelector(".audio");

let ACTIVE_ID = 0;
let DEBOUNCE_TIMER = null;
let STATUS_TIMER = null;
let LAST_CONTENT = null;

/**
 * Ask the background script to abandon the lookup that is still running,
 * so an older answer can never overwrite a newer one.
 */
function cancelActive() {
  if (ACTIVE_ID > 0) {
    browser.runtime
      .sendMessage({ type: "cancel", requestId: String(ACTIVE_ID) })
      .catch(() => {});
  }
  clearTimeout(STATUS_TIMER);
}

function showStatus(text, loading) {
  resultEl.hidden = false;
  statusEl.hidden = false;
  statusEl.textContent = text;
  statusEl.classList.toggle("loading", loading);
  definitionsEl.hidden = true;
  moreInfoEl.hidden = true;
  audioEl.hidden = true;
}

function clearResult() {
  resultEl.hidden = true;
  headingEl.textContent = "";
  pronunciationEl.textContent = "";
  definitionsEl.textContent = "";
  definitionsEl.hidden = true;
  moreInfoEl.hidden = true;
  audioEl.hidden = true;
}

/**
 * Render a meaning object from the background script into the panel.
 *
 * @param content {{word: string, phoneticText: string, audioSrc: string, meanings: Array, sourceUrl: string, license: string}}
 */
function render(content) {
  LAST_CONTENT = content;

  resultEl.hidden = false;
  statusEl.hidden = true;
  headingEl.textContent = content.word;
  pronunciationEl.textContent = content.phoneticText || "";

  definitionsEl.textContent = "";
  for (const meaning of content.meanings) {
    const li = document.createElement("li");

    const posSpan = document.createElement("span");
    posSpan.classList.add("pos");
    posSpan.textContent = `${meaning.partOfSpeech}: `;
    li.appendChild(posSpan);

    li.append(meaning.definition);

    if (meaning.example) {
      const example = document.createElement("i");
      example.classList.add("example");
      example.textContent = meaning.example;
      li.appendChild(document.createElement("br"));
      li.appendChild(example);
    }

    definitionsEl.appendChild(li);
  }
  definitionsEl.hidden = false;

  moreInfoEl.href = `https://en.wiktionary.org/wiki/${encodeURIComponent(content.word)}`;
  moreInfoEl.hidden = false;
  audioEl.hidden = false;
}

/**
 * Play the recorded pronunciation if there is one, else fall back to
 * synthesizing the word.
 *
 * @param word {string}
 * @param audioSrc {string}
 */
function playPronunciation(word, audioSrc) {
  if (audioSrc) {
    try {
      const player = new Audio(audioSrc);
      const onError = () =>
        window.speechSynthesis?.speak(new SpeechSynthesisUtterance(word));
      player.addEventListener("error", onError, { once: true });
      player.play().catch(() => {
        player.removeEventListener("error", onError);
        window.speechSynthesis?.speak(new SpeechSynthesisUtterance(word));
      });
      return;
    } catch {
      /* no audio element available */
    }
  }
  window.speechSynthesis?.speak(new SpeechSynthesisUtterance(word));
}

/**
 * Look up a term through the background script, superseding any lookup
 * that is still in flight.
 *
 * @param term {string}
 */
function lookup(term) {
  cancelActive();
  ACTIVE_ID += 1;
  const id = String(ACTIVE_ID);

  showStatus("Please wait…", true);
  STATUS_TIMER = setTimeout(() => {
    if (id === String(ACTIVE_ID)) {
      showStatus("Still searching…", true);
    }
  }, STATUS_UPDATE_DELAY_MS);

  browser.runtime
    .sendMessage({ word: term, lang: "en", time: Date.now(), requestId: id })
    .then((response) => {
      if (id !== String(ACTIVE_ID)) {
        return; // superseded by a newer lookup
      }
      clearTimeout(STATUS_TIMER);

      const content = response?.content;
      if (!content) {
        headingEl.textContent = term;
        pronunciationEl.textContent = "";
        showStatus("No definition was found.", false);
        return;
      }
      render(content);
    })
    .catch(() => {
      if (id !== String(ACTIVE_ID)) {
        return;
      }
      clearTimeout(STATUS_TIMER);
      showStatus("Lookup failed.", false);
    });
}

searchEl.addEventListener("input", () => {
  clearTimeout(DEBOUNCE_TIMER);
  const term = searchEl.value.trim();
  if (!term) {
    cancelActive();
    ACTIVE_ID += 1; // invalidate answers that are already on their way
    LAST_CONTENT = null;
    clearResult();
    return;
  }
  DEBOUNCE_TIMER = setTimeout(() => lookup(term), DEBOUNCE_MS);
});

searchEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    clearTimeout(DEBOUNCE_TIMER);
    const term = searchEl.value.trim();
    if (term) {
      lookup(term);
    }
  }
});

audioEl.addEventListener("click", () => {
  if (LAST_CONTENT) {
    playPronunciation(LAST_CONTENT.word, LAST_CONTENT.audioSrc);
  }
});
