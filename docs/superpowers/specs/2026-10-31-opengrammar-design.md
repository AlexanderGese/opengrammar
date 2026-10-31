# OpenGrammar — Design

Date: 2026-10-31
Status: approved (user: "just go")

## Goal

A Grammarly-style browser extension that underlines grammar/spelling issues as you type and offers
"better wording" rewrites, running **locally by default**: a rule engine for grammar and a tiny
in-browser LLM for wording. No accounts, no cloud by default.

## Scope

**v1 includes**
- Live underlines in `<textarea>`, text `<input>`, and generic `contenteditable` editors.
- A built-in OpenGrammar editor page (extension page) as the fallback for editors we can't hook (Google Docs etc.).
- Grammar: Harper (English, WASM). Other languages: LanguageTool on localhost (Full mode) or the local model (Light mode).
- Wording: on-demand rewrites (Rephrase / Shorter / Clearer / Formal / Friendlier) always available;
  proactive "this sentence could be clearer" suggestions as a setting.
- Light / Full mode, with grammar engine and model size independently selectable.
- Personal dictionary, per-site ignore.
- Chromium (Chrome, Edge, Brave) and Firefox from one WXT codebase.

**Out of scope for v1**
- Google Docs / Word Online / Overleaf adapters.
- Native helper app (the engine interface leaves room for it — see "Future").
- Accounts, sync servers, cloud LLMs, mobile.

## Delivery

- **Plan 1 — Foundation + live grammar:** scaffold, engine interface, Harper, orchestrator, settings, adapters, overlay,
  suggestion card, personal dictionary, ignored sites, popup, options. Ships a working English grammar checker.
- **Plan 2 — Model + wording + multilingual:** ModelEngine (WebGPU/wllama), validator, rewrites, proactive scan,
  LanguageToolEngine, Light/Full mode UI, editor page.

## Stack

- **WXT** (cross-browser MV3 extension framework) + **TypeScript** + Vite.
- Plain TypeScript + DOM for popup and options (they are two small forms; no UI framework needed).
  Content-script UI is plain TS inside a Shadow DOM (small, isolated from page CSS).
- **harper.js** (Harper grammar checker, WASM). The extension loads the separate `.wasm` file
  (`harper.js/binary`); the inlined build is a 27 MB JS file and is used only in unit tests.
- **@mlc-ai/web-llm** for WebGPU inference; **wllama** (llama.cpp WASM) as CPU fallback.
- **Vitest** (+ happy-dom) for unit tests, **Playwright** for extension e2e in Chromium.

## Architecture

```
Content script (every page)
  FieldWatcher    finds editable fields, attaches on focus
  TextAdapter     plain text  <->  DOM ranges; applies replacements
  Overlay         Shadow-DOM layer drawing underlines (solid = rule engine, dotted = AI)
  SuggestionCard  popup: apply / ignore / add to dictionary / rewrite styles
        |  runtime messages
Background (Chromium service worker / Firefox event page)
  Orchestrator    debounce, language detection, routing, sentence cache, dictionary filter
  Settings        typed wrapper over storage.sync
        |  Engine interface
  HarperEngine        harper.js WASM, English
  LanguageToolEngine  HTTP POST {ltUrl}/v2/check
  ModelEngine         Worker; in Chromium hosted in an offscreen document (reason WORKERS),
                      in Firefox in the background page. WebGPU -> wllama fallback.
Extension pages: popup, options, editor
```

### Engine interface

```ts
type Lang = string; // BCP-47 primary tag, e.g. "en", "de"

interface Issue {
  id: string;
  start: number; end: number;          // UTF-16 offsets into the checked text
  kind: "spelling" | "grammar" | "style" | "wording";
  source: "harper" | "languagetool" | "model";
  message: string;
  replacements: string[];              // best first; may be empty
  confidence: "high" | "low";          // model output is always "low"
}

interface GrammarEngine {
  id: "harper" | "languagetool" | "model";
  supports(lang: Lang): boolean;
  check(text: string, lang: Lang, signal: AbortSignal): Promise<Issue[]>;
}

type RewriteStyle = "rephrase" | "shorter" | "clearer" | "formal" | "friendly";

interface WordingEngine {
  rewrite(text: string, style: RewriteStyle, lang: Lang, signal: AbortSignal): Promise<string[]>; // 1–3 options
  scan(paragraph: string, lang: Lang, signal: AbortSignal): Promise<Issue[]>;                    // kind = "wording"
}
```

Engines know nothing about the DOM. A future native helper is just another implementation.

### Routing (Orchestrator)

1. Content script sends `{fieldId, version, text}` 300 ms after the last input.
2. Detect language with `browser.i18n.detectLanguage` (both browsers); fall back to the user's
   configured default language when unreliable.
3. Split into sentences (`Intl.Segmenter`); look each up in an LRU cache keyed by `(engine, lang, sentence)`.
4. Uncached sentences go to the grammar engine:
   - `en` → Harper.
   - other + Full mode + LanguageTool reachable → LanguageTool.
   - other otherwise → ModelEngine grammar check (dotted underlines, `confidence: "low"`).
5. If proactive wording is on, after 1000 ms idle, finished sentences go to `WordingEngine.scan`.
6. Filter out issues whose flagged word is in the personal dictionary; drop issues the user ignored for this text.
7. Reply `{fieldId, version, issues}`. The content script discards replies whose `version` is stale.

### Model use and safety

- Models (verify exact IDs against the WebLLM prebuilt list at implementation time):
  - tiny (Light default): Qwen3-0.6B, q4 (~400 MB).
  - small (Full default): Qwen3-1.7B, q4 (~1 GB).
- Lazy load on first need; unload after 5 min idle. Download progress shown in popup.
- Grammar check and scan prompts require JSON output: `[{ "original": "...", "replacement": "...", "reason": "..." }]`.
- **Validator** (pure function, heavily tested) drops any edit where:
  - `original` is not found verbatim in the sentence;
  - `original` is longer than 60% of the sentence (grammar) — scan is allowed whole-sentence edits;
  - the replacement equals the original;
  - normalized edit distance exceeds a threshold for grammar edits (meaning changes).
- Invalid JSON → zero issues (never an error shown to the user).

### Modes and settings

```ts
interface Settings {
  enabled: boolean;
  mode: "light" | "full";                 // preset that sets the two below
  grammarEngineForOther: "model" | "languagetool";
  modelSize: "tiny" | "small";
  proactiveWording: boolean;              // light: false, full: true (user-overridable)
  languageToolUrl: string;                // default http://localhost:8081
  defaultLanguage: Lang;                  // "en"
  dictionary: string[];
  ignoredSites: string[];                 // hostnames
}
```

Stored as one item in `storage.local` (`storage.sync` caps items at 8 KB, too small for a dictionary). Switching `mode` applies the preset; individual fields can then be changed.
Options page documents the LanguageTool command: `docker run -d -p 8081:8010 erikvl87/languagetool`.

## UI

- **Underlines:** red solid = spelling, blue solid = grammar, purple dotted = AI (model grammar or wording).
- **SuggestionCard** on click/hover of an underline: message, replacement buttons, "Ignore", "Add to dictionary"
  (spelling only), and for any sentence a "Rewrite ▾" menu with the five styles.
- **Selection rewrite:** selecting text in a hooked field shows a small OpenGrammar button → rewrite menu.
- **Field badge:** small corner icon with issue count; spinner while the model works.
- **Popup:** on/off, Light/Full toggle, "Disable on this site", model status (not loaded / downloading x% / ready),
  LanguageTool status, link to editor page.
- **Options:** all settings, dictionary list editor, ignored-sites list editor.
- **Editor page:** a plain contenteditable document with the same engine, plus copy-out button. Text kept in
  `storage.local` so it survives reloads.

## Text adapters

- **TextareaAdapter** (textarea, input[type=text|search|url]; `email` is excluded because it has no selection API): mirror-div technique — a hidden div copying the
  field's computed styles to measure character positions. Overlay is positioned over the field and
  synced on scroll, resize (`ResizeObserver`) and input.
- **ContentEditableAdapter:** walks text nodes to build `text` plus an offset→(node, offset) map; block elements and
  `<br>` become `\n`. Underline rectangles come from `Range.getClientRects()`.
- **Applying a replacement:** select the range, then `document.execCommand("insertText", …)` so the editor's own
  undo stack and input events work; fallback to direct value set + synthetic `input` event for textareas.
- Fields skipped: password, read-only/disabled, anything inside `[data-gramm="false"]` or `[data-opengrammar="false"]`,
  code editors (CodeMirror/Monaco/Ace class markers), ignored sites.

## Error handling

| Failure | Behaviour |
|---|---|
| LanguageTool unreachable | Route that language to the model; popup shows "LanguageTool offline"; re-probe every 60 s. |
| WebGPU unavailable / init fails | Fall back to wllama CPU; if that fails, disable model features and show why in the popup. |
| Model download interrupted | Resumable via browser cache; retry button in popup. |
| Model returns garbage | Validator drops it; no user-visible error. |
| Stale results | Version counter per field; stale replies discarded. In-flight work aborted via `AbortSignal`. |
| Page DOM changes under us | Adapter re-reads text on mutation; overlay hides underlines whose range no longer matches. |

## Testing

- **Unit (Vitest):** Orchestrator routing and caching (fake engines), validator, dictionary/ignore filters,
  sentence splitting, settings presets, LanguageTool response mapping (fixture JSON), Harper engine against real WASM.
- **Adapter tests (happy-dom + Playwright):** offset↔DOM mapping for nested contenteditable markup; replacement
  keeps surrounding text intact.
- **E2E (Playwright, Chromium with the built extension):** fixture page with textarea + contenteditable —
  typo gets underlined, applying a fix updates the text, add-to-dictionary removes the underline, ignored site shows nothing.
  ModelEngine is replaced by a deterministic fake in e2e.
- **Manual smoke:** real model load on WebGPU and CPU fallback, German text in Light and Full mode, Firefox.

## Performance budgets

- Harper: < 50 ms for 2 000 characters.
- Grammar debounce 300 ms; wording scan after 1 000 ms idle, finished sentences only.
- Content script < 100 KB; Harper WASM and model code loaded only in background/offscreen contexts.

## Future

- Native helper (Rust, native messaging): native Harper, llama.cpp with Vulkan/CUDA, manages LanguageTool lifecycle —
  plugs in as another `GrammarEngine` / `WordingEngine`.
- Google Docs adapter.
- Tone indicator, writing stats.
