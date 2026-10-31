# OpenGrammar Plan 1 — Foundation + Live Grammar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chromium + Firefox extension that underlines English grammar and spelling issues as you type in textareas,
text inputs and contenteditable editors, lets you apply a fix, ignore it, or add a word to a personal dictionary,
and can be disabled per site.

**Architecture:** WXT MV3 extension. The content script finds editable fields, maps their text to DOM positions and
draws underlines in a Shadow-DOM overlay. It sends plain text to the background, where an Orchestrator splits it into
sentences, caches per sentence, and asks a `GrammarEngine` (Harper, compiled to WASM) for issues. Engines know nothing
about the DOM.

**Tech Stack:** WXT 0.21.5, TypeScript 5.9, harper.js 3.0.0, Vitest 5.0.5 + happy-dom 21.0.4, Playwright 1.64.1. Node ≥ 22.

Spec: `docs/superpowers/specs/2026-10-31-opengrammar-design.md`

## Global Constraints

- All text offsets are UTF-16 code-unit offsets (plain JS string indices). Harper spans are already in these units.
- Nothing leaves the machine: no network calls in Plan 1 (Harper's `.wasm` is loaded from the extension package).
- Settings live in **one** storage item, `local:settings` (a `Partial<Settings>` merged over `DEFAULT_SETTINGS`).
- Manifest V3 for both browsers. Firefox gecko id `opengrammar@opengrammar.dev`, `strict_min_version` `128.0`.
- CSP for extension pages: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`.
- The content script must **never** import `harper.js` (it would ship 20 MB into every page).
- Underline colours: spelling `#e5484d` solid, grammar/style `#3e63dd` solid, AI (`confidence: "low"`) dotted.
- Grammar debounce 300 ms after the last input.
- Source lives in `src/`; the `@/` import alias points at `src/`.
- Unit tests: `tests/**/*.test.ts`. DOM tests start with `// @vitest-environment happy-dom`.

## File Structure

```
package.json, wxt.config.ts, tsconfig.json, vitest.config.ts, playwright.config.ts, .gitignore
src/lib/types.ts                      Issue, GrammarEngine, message types + guards
src/lib/sentences.ts                  splitSentences()
src/lib/cache.ts                      LruCache
src/lib/settings.ts                   Settings, defaults, presets, storage helpers, site matching
src/lib/filters.ts                    filterDictionary(), ignoreKey()
src/lib/rebase.ts                     rebaseIssues() — shift issues after an edit
src/lib/language.ts                   detectLang()
src/engines/harper.ts                 HarperEngine
src/background/orchestrator.ts        Orchestrator
src/entrypoints/background.ts         wiring: engines + messaging
src/content/eligibility.ts            findEditable()
src/content/adapters/types.ts         TextAdapter, TextRange
src/content/adapters/textarea.ts      TextareaAdapter (mirror-div)
src/content/adapters/contenteditable.ts ContentEditableAdapter
src/content/card.ts                   SuggestionCard + CARD_CSS
src/content/overlay.ts                Overlay (Shadow DOM underline layer)
src/content/session.ts                FieldSession (debounce, versioning, render, click)
src/entrypoints/content.ts            wiring: focus tracking, settings, sessions
src/assets/page.css                   shared popup/options styles
src/entrypoints/popup/{index.html,main.ts}
src/entrypoints/options/{index.html,main.ts}
tests/...                             unit tests mirroring src/
e2e/fixtures.ts, e2e/fixtures/page.html, e2e/*.spec.ts
```

---

### Task 1: Project scaffold, core types, sentence splitting, LRU cache

**Files:**
- Create: `package.json`, `wxt.config.ts`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/lib/types.ts`, `src/lib/sentences.ts`, `src/lib/cache.ts`
- Create: `src/entrypoints/background.ts` (temporary stub, replaced in Task 4)
- Test: `tests/lib/sentences.test.ts`, `tests/lib/cache.test.ts`

**Interfaces:**
- Produces:
  - `type Lang = string`; `type IssueKind = 'spelling'|'grammar'|'style'|'wording'`; `type IssueSource = 'harper'|'languagetool'|'model'`
  - `interface Issue { id: string; start: number; end: number; kind: IssueKind; source: IssueSource; message: string; replacements: string[]; confidence: 'high'|'low' }`
  - `interface GrammarEngine { readonly id: IssueSource; supports(lang: Lang): boolean; check(text: string, lang: Lang, signal: AbortSignal): Promise<Issue[]> }`
  - `interface CheckRequest { type: 'og:check'; fieldId: string; text: string }`, `interface CheckResponse { issues: Issue[] }`, `isCheckRequest(m: unknown): m is CheckRequest`
  - `interface Sentence { text: string; start: number }`, `splitSentences(text: string): Sentence[]`
  - `class LruCache<V> { constructor(max: number); get(key: string): V | undefined; set(key: string, value: V): void; get size(): number }`

- [ ] **Step 1: Write the project files**

`package.json`:
```json
{
  "name": "opengrammar",
  "description": "Local, private grammar checking and better wording.",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "dev:firefox": "wxt -b firefox",
    "build": "wxt build",
    "build:firefox": "wxt build -b firefox",
    "zip": "wxt zip",
    "zip:firefox": "wxt zip -b firefox",
    "compile": "tsc --noEmit",
    "test": "vitest run",
    "e2e": "wxt build && playwright test",
    "postinstall": "wxt prepare"
  }
}
```

`wxt.config.ts`:
```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'OpenGrammar',
    description: 'Local, private grammar checking and better wording.',
    permissions: ['storage', 'activeTab'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: { id: 'opengrammar@opengrammar.dev', strict_min_version: '128.0' },
      },
    }),
  }),
});
```

`tsconfig.json`:
```json
{ "extends": "./.wxt/tsconfig.json" }
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: { include: ['tests/**/*.test.ts'], testTimeout: 30_000 },
});
```

`.gitignore`:
```
node_modules
.output
.wxt
test-results
playwright-report
```

`src/entrypoints/background.ts` (stub so `wxt build` has an entrypoint):
```ts
export default defineBackground(() => {});
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm i harper.js@3.0.0
npm i -D wxt@0.21.5 typescript@^5.9.3 vitest@5.0.5 happy-dom@21.0.4 @playwright/test@1.64.1
```
Expected: installs cleanly; `postinstall` runs `wxt prepare` and creates `.wxt/`.

- [ ] **Step 3: Write `src/lib/types.ts`**

```ts
export type Lang = string;
export type IssueKind = 'spelling' | 'grammar' | 'style' | 'wording';
export type IssueSource = 'harper' | 'languagetool' | 'model';

export interface Issue {
  id: string;
  start: number;
  end: number;
  kind: IssueKind;
  source: IssueSource;
  message: string;
  replacements: string[];
  confidence: 'high' | 'low';
}

export interface GrammarEngine {
  readonly id: IssueSource;
  supports(lang: Lang): boolean;
  check(text: string, lang: Lang, signal: AbortSignal): Promise<Issue[]>;
}

export interface CheckRequest {
  type: 'og:check';
  fieldId: string;
  text: string;
}

export interface CheckResponse {
  issues: Issue[];
}

export function isCheckRequest(message: unknown): message is CheckRequest {
  if (typeof message !== 'object' || message === null) return false;
  const m = message as Partial<CheckRequest>;
  return m.type === 'og:check' && typeof m.fieldId === 'string' && typeof m.text === 'string';
}
```

- [ ] **Step 4: Write failing tests for sentences and cache**

`tests/lib/sentences.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { splitSentences } from '@/lib/sentences';

describe('splitSentences', () => {
  it('splits sentences and keeps their offsets', () => {
    expect(splitSentences('Hello world. How are you?')).toEqual([
      { text: 'Hello world. ', start: 0 },
      { text: 'How are you?', start: 13 },
    ]);
  });

  it('skips whitespace-only segments', () => {
    expect(splitSentences('   ')).toEqual([]);
  });

  it('offsets always point back into the original text', () => {
    const text = 'First line\nSecond line. 😀 Third one!';
    for (const s of splitSentences(text)) {
      expect(text.slice(s.start, s.start + s.text.length)).toBe(s.text);
    }
  });
});
```

`tests/lib/cache.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { LruCache } from '@/lib/cache';

describe('LruCache', () => {
  it('returns stored values', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    expect(c.get('a')).toBe(1);
    expect(c.get('missing')).toBeUndefined();
  });

  it('evicts the least recently used entry', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a'); // a is now most recent
    c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
    expect(c.size).toBe(2);
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx vitest run tests/lib`
Expected: FAIL — cannot resolve `@/lib/sentences` / `@/lib/cache`.

- [ ] **Step 6: Implement**

`src/lib/sentences.ts`:
```ts
export interface Sentence {
  text: string;
  start: number;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });

export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  for (const { segment, index } of segmenter.segment(text)) {
    if (segment.trim() === '') continue;
    sentences.push({ text: segment, start: index });
  }
  return sentences;
}
```

`src/lib/cache.ts`:
```ts
export class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}
```

- [ ] **Step 7: Run tests and build**

Run: `npx vitest run tests/lib && npm run build`
Expected: 5 tests PASS; build writes `.output/chrome-mv3/manifest.json`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold WXT extension with core types, sentence splitter and LRU cache"
```

---

### Task 2: Settings, dictionary filter, issue rebasing, language detection

**Files:**
- Create: `src/lib/settings.ts`, `src/lib/filters.ts`, `src/lib/rebase.ts`, `src/lib/language.ts`
- Test: `tests/lib/settings.test.ts`, `tests/lib/filters.test.ts`, `tests/lib/rebase.test.ts`, `tests/lib/language.test.ts`

**Interfaces:**
- Consumes: `Issue`, `Lang` from `@/lib/types`.
- Produces:
  - `type Mode = 'light'|'full'`; `interface Settings { enabled: boolean; mode: Mode; grammarEngineForOther: 'model'|'languagetool'; modelSize: 'tiny'|'small'; proactiveWording: boolean; languageToolUrl: string; defaultLanguage: Lang; dictionary: string[]; ignoredSites: string[] }`
  - `DEFAULT_SETTINGS: Settings`, `MODE_PRESETS`, `withMode(s: Settings, mode: Mode): Settings`
  - `getSettings(): Promise<Settings>`, `updateSettings(patch: Partial<Settings>): Promise<Settings>`, `watchSettings(cb: (s: Settings) => void): () => void`
  - `addToDictionary(word: string): Promise<void>`
  - `isSiteIgnored(hostname: string, ignoredSites: string[]): boolean`, `normalizeSite(input: string): string | null`
  - `filterDictionary(issues: Issue[], text: string, dictionary: string[]): Issue[]`, `ignoreKey(text: string, issue: Issue): string`
  - `rebaseIssues(issues: Issue[], oldText: string, newText: string): Issue[]`
  - `type Detector = (text: string) => Promise<{ isReliable: boolean; languages: { language: string; percentage: number }[] }>`, `detectLang(text: string, fallback: Lang, detector: Detector): Promise<Lang>`

- [ ] **Step 1: Write failing tests**

`tests/lib/settings.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_SETTINGS, addToDictionary, getSettings, isSiteIgnored, normalizeSite, updateSettings, withMode,
} from '@/lib/settings';

beforeEach(() => fakeBrowser.reset());

describe('settings storage', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('merges updates over defaults', async () => {
    await updateSettings({ enabled: false });
    expect(await getSettings()).toEqual({ ...DEFAULT_SETTINGS, enabled: false });
  });

  it('adds dictionary words once, case-insensitively', async () => {
    await addToDictionary('Zorblax');
    await addToDictionary('zorblax');
    expect((await getSettings()).dictionary).toEqual(['Zorblax']);
  });
});

describe('withMode', () => {
  it('applies the full preset', () => {
    expect(withMode(DEFAULT_SETTINGS, 'full')).toMatchObject({
      mode: 'full', grammarEngineForOther: 'languagetool', modelSize: 'small', proactiveWording: true,
    });
  });
});

describe('isSiteIgnored', () => {
  it('matches the host and its subdomains', () => {
    expect(isSiteIgnored('reddit.com', ['reddit.com'])).toBe(true);
    expect(isSiteIgnored('old.reddit.com', ['reddit.com'])).toBe(true);
    expect(isSiteIgnored('notreddit.com', ['reddit.com'])).toBe(false);
    expect(isSiteIgnored('example.com', [''])).toBe(false);
  });
});

describe('normalizeSite', () => {
  it('extracts a lowercase hostname', () => {
    expect(normalizeSite('https://Mail.Google.com/inbox')).toBe('mail.google.com');
    expect(normalizeSite(' reddit.com ')).toBe('reddit.com');
    expect(normalizeSite('   ')).toBeNull();
    expect(normalizeSite('not a url')).toBeNull();
  });
});
```

`tests/lib/filters.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { filterDictionary, ignoreKey } from '@/lib/filters';
import type { Issue } from '@/lib/types';

const issue = (start: number, end: number, kind: Issue['kind'] = 'spelling'): Issue => ({
  id: `i${start}`, start, end, kind, source: 'harper', message: 'm', replacements: [], confidence: 'high',
});

describe('filterDictionary', () => {
  const text = 'Zorblax went home';

  it('drops spelling issues for dictionary words, ignoring case', () => {
    expect(filterDictionary([issue(0, 7)], text, ['zorblax'])).toEqual([]);
  });

  it('keeps non-spelling issues and other words', () => {
    const kept = [issue(0, 7, 'grammar'), issue(8, 12)];
    expect(filterDictionary(kept, text, ['zorblax'])).toEqual(kept);
  });
});

describe('ignoreKey', () => {
  it('depends on the flagged text and message, not the position', () => {
    expect(ignoreKey('teh cat', issue(0, 3))).toBe(ignoreKey('a teh cat', issue(2, 5)));
  });
});
```

`tests/lib/rebase.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { rebaseIssues } from '@/lib/rebase';
import type { Issue } from '@/lib/types';

const at = (start: number, end: number): Issue => ({
  id: `i${start}`, start, end, kind: 'spelling', source: 'harper', message: 'm', replacements: [], confidence: 'high',
});

describe('rebaseIssues', () => {
  const old = 'This is teh test';

  it('shifts issues after an insertion before them', () => {
    expect(rebaseIssues([at(8, 11)], old, 'Yes! This is teh test')).toEqual([at(13, 16)]);
  });

  it('keeps issues before an edit unchanged', () => {
    expect(rebaseIssues([at(8, 11)], old, 'This is teh test!')).toEqual([at(8, 11)]);
  });

  it('drops issues the edit touches', () => {
    expect(rebaseIssues([at(8, 11)], old, 'This is tehh test')).toEqual([]);
    expect(rebaseIssues([at(8, 11)], old, 'This is the test')).toEqual([]);
  });

  it('returns the same issues when text is unchanged', () => {
    const issues = [at(8, 11)];
    expect(rebaseIssues(issues, old, old)).toBe(issues);
  });
});
```

`tests/lib/language.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { detectLang, type Detector } from '@/lib/language';

const LONG = 'This sentence is long enough to detect a language reliably.';
const fixed = (language: string, isReliable = true): Detector =>
  async () => ({ isReliable, languages: [{ language, percentage: 100 }] });

describe('detectLang', () => {
  it('returns the primary language tag', async () => {
    expect(await detectLang(LONG, 'en', fixed('de-AT'))).toBe('de');
  });

  it('falls back for short text, unreliable or undetermined results, and errors', async () => {
    expect(await detectLang('Hi', 'en', fixed('de'))).toBe('en');
    expect(await detectLang(LONG, 'en', fixed('de', false))).toBe('en');
    expect(await detectLang(LONG, 'en', fixed('und'))).toBe('en');
    expect(await detectLang(LONG, 'en', async () => { throw new Error('x'); })).toBe('en');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib`
Expected: FAIL — modules `@/lib/settings`, `@/lib/filters`, `@/lib/rebase`, `@/lib/language` not found.

- [ ] **Step 3: Implement**

`src/lib/settings.ts`:
```ts
import { storage } from 'wxt/utils/storage';
import type { Lang } from './types';

export type Mode = 'light' | 'full';

export interface Settings {
  enabled: boolean;
  mode: Mode;
  grammarEngineForOther: 'model' | 'languagetool';
  modelSize: 'tiny' | 'small';
  proactiveWording: boolean;
  languageToolUrl: string;
  defaultLanguage: Lang;
  dictionary: string[];
  ignoredSites: string[];
}

type ModePreset = Pick<Settings, 'grammarEngineForOther' | 'modelSize' | 'proactiveWording'>;

export const MODE_PRESETS: Record<Mode, ModePreset> = {
  light: { grammarEngineForOther: 'model', modelSize: 'tiny', proactiveWording: false },
  full: { grammarEngineForOther: 'languagetool', modelSize: 'small', proactiveWording: true },
};

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  mode: 'light',
  ...MODE_PRESETS.light,
  languageToolUrl: 'http://localhost:8081',
  defaultLanguage: 'en',
  dictionary: [],
  ignoredSites: [],
};

const settingsItem = storage.defineItem<Partial<Settings>>('local:settings', { fallback: {} });

export function withMode(settings: Settings, mode: Mode): Settings {
  return { ...settings, mode, ...MODE_PRESETS[mode] };
}

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await settingsItem.getValue()) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await settingsItem.setValue(next);
  return next;
}

export function watchSettings(callback: (settings: Settings) => void): () => void {
  return settingsItem.watch((value) => callback({ ...DEFAULT_SETTINGS, ...value }));
}

export async function addToDictionary(word: string): Promise<void> {
  const { dictionary } = await getSettings();
  if (dictionary.some((w) => w.toLowerCase() === word.toLowerCase())) return;
  await updateSettings({ dictionary: [...dictionary, word] });
}

export function isSiteIgnored(hostname: string, ignoredSites: string[]): boolean {
  const host = hostname.toLowerCase();
  return ignoredSites.some((entry) => {
    const site = entry.trim().toLowerCase();
    return site !== '' && (host === site || host.endsWith(`.${site}`));
  });
}

export function normalizeSite(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (raw === '') return null;
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname || null;
  } catch {
    return null;
  }
}
```

`src/lib/filters.ts`:
```ts
import type { Issue } from './types';

export function filterDictionary(issues: Issue[], text: string, dictionary: string[]): Issue[] {
  if (dictionary.length === 0) return issues;
  const words = new Set(dictionary.map((w) => w.toLowerCase()));
  return issues.filter(
    (issue) => issue.kind !== 'spelling' || !words.has(text.slice(issue.start, issue.end).toLowerCase()),
  );
}

/** Identifies an issue independent of where it sits, so "Ignore" survives edits elsewhere. */
export function ignoreKey(text: string, issue: Issue): string {
  return `${text.slice(issue.start, issue.end)}\u0000${issue.message}`;
}
```

`src/lib/rebase.ts`:
```ts
import type { Issue } from './types';

/**
 * Moves issues to match `newText` after a single contiguous edit, so underlines stay put while
 * the next check is pending. Issues that touch the edited region are dropped.
 */
export function rebaseIssues(issues: Issue[], oldText: string, newText: string): Issue[] {
  if (oldText === newText) return issues;

  const max = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < max && oldText[prefix] === newText[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) suffix++;

  const editEnd = oldText.length - suffix;
  const delta = newText.length - oldText.length;

  return issues.flatMap((issue) => {
    if (issue.end < prefix) return [issue];
    if (issue.start > editEnd) return [{ ...issue, start: issue.start + delta, end: issue.end + delta }];
    return [];
  });
}
```

`src/lib/language.ts`:
```ts
import type { Lang } from './types';

export type Detector = (text: string) => Promise<{
  isReliable: boolean;
  languages: { language: string; percentage: number }[];
}>;

const MIN_LENGTH = 20;

export async function detectLang(text: string, fallback: Lang, detector: Detector): Promise<Lang> {
  if (text.trim().length < MIN_LENGTH) return fallback;
  try {
    const result = await detector(text);
    const top = result.languages[0];
    if (!result.isReliable || !top) return fallback;
    const lang = top.language.split('-')[0].toLowerCase();
    return lang === 'und' ? fallback : lang;
  } catch {
    return fallback;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib`
Expected: all PASS. (`'Yes! '` inserts 5 characters before `teh`, moving it from 8–11 to 13–16.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: settings storage, dictionary filter, issue rebasing and language detection"
```

---

### Task 3: Harper grammar engine

**Files:**
- Create: `src/engines/harper.ts`
- Test: `tests/engines/harper.test.ts`

**Interfaces:**
- Consumes: `GrammarEngine`, `Issue`, `IssueKind`, `Lang` from `@/lib/types`.
- Produces: `class HarperEngine implements GrammarEngine` with `constructor(binary: LinterInit['binary'])`, `id = 'harper'`,
  `supports(lang) === (lang === 'en')`; `toIssueKind(lintKind: string): IssueKind`.

- [ ] **Step 1: Write the failing test**

`tests/engines/harper.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { binaryInlined } from 'harper.js/binaryInlined';
import { HarperEngine, toIssueKind } from '@/engines/harper';

const engine = new HarperEngine(binaryInlined);
const signal = new AbortController().signal;

describe('HarperEngine', () => {
  it('supports only English', () => {
    expect(engine.supports('en')).toBe(true);
    expect(engine.supports('de')).toBe(false);
  });

  it('finds a typo with its replacement', async () => {
    const text = 'This is teh test.';
    const issues = await engine.check(text, 'en', signal);
    const typo = issues.find((i) => text.slice(i.start, i.end) === 'teh');
    expect(typo).toMatchObject({ kind: 'spelling', source: 'harper', confidence: 'high' });
    expect(typo?.replacements).toContain('the');
  });

  it('reports UTF-16 offsets after an emoji', async () => {
    const text = '😀 I has a apple.';
    const issues = await engine.check(text, 'en', signal);
    expect(issues.map((i) => text.slice(i.start, i.end))).toContain('has');
  });

  it('returns nothing when already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await engine.check('This is teh test.', 'en', ctrl.signal)).toEqual([]);
  });
});

describe('toIssueKind', () => {
  it('maps Harper lint kinds', () => {
    expect(toIssueKind('Typo')).toBe('spelling');
    expect(toIssueKind('Spelling')).toBe('spelling');
    expect(toIssueKind('Readability')).toBe('style');
    expect(toIssueKind('Agreement')).toBe('grammar');
    expect(toIssueKind('SomethingNew')).toBe('grammar');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engines/harper.test.ts`
Expected: FAIL — cannot resolve `@/engines/harper`.

- [ ] **Step 3: Implement**

`src/engines/harper.ts`:
```ts
import { LocalLinter, SuggestionKind, type Lint, type LinterInit } from 'harper.js';
import type { GrammarEngine, Issue, IssueKind, Lang } from '@/lib/types';

const KINDS: Record<string, IssueKind> = {
  Spelling: 'spelling',
  Typo: 'spelling',
  Style: 'style',
  Readability: 'style',
  Enhancement: 'style',
  WordChoice: 'style',
  Redundancy: 'style',
  Repetition: 'style',
  Formatting: 'style',
};

export function toIssueKind(lintKind: string): IssueKind {
  return KINDS[lintKind] ?? 'grammar';
}

export class HarperEngine implements GrammarEngine {
  readonly id = 'harper' as const;
  private readonly linter: LocalLinter;
  private ready: Promise<void> | null = null;

  constructor(binary: LinterInit['binary']) {
    this.linter = new LocalLinter({ binary });
  }

  supports(lang: Lang): boolean {
    return lang === 'en';
  }

  async check(text: string, _lang: Lang, signal: AbortSignal): Promise<Issue[]> {
    if (signal.aborted) return [];
    this.ready ??= this.linter.setup();
    await this.ready;
    if (signal.aborted) return [];
    const lints = await this.linter.lint(text, { language: 'plaintext' });
    return lints.map((lint, n) => toIssue(lint, text, n));
  }
}

function toIssue(lint: Lint, text: string, n: number): Issue {
  const { start, end } = lint.span();
  const original = text.slice(start, end);
  const replacements = lint.suggestions().map((s) => {
    switch (s.kind()) {
      case SuggestionKind.Remove:
        return '';
      case SuggestionKind.InsertAfter:
        return original + s.get_replacement_text();
      default:
        return s.get_replacement_text();
    }
  });
  return {
    id: `harper-${start}-${end}-${n}`,
    start,
    end,
    kind: toIssueKind(lint.lint_kind()),
    source: 'harper',
    message: lint.message(),
    replacements,
    confidence: 'high',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engines/harper.test.ts`
Expected: all PASS (the first test loads the WASM; allow a few seconds).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: Harper grammar engine"
```

---

### Task 4: Orchestrator and background wiring

**Files:**
- Create: `src/background/orchestrator.ts`
- Modify: `src/entrypoints/background.ts` (replace stub)
- Test: `tests/background/orchestrator.test.ts`

**Interfaces:**
- Consumes: `GrammarEngine`, `Issue`, `Lang`, `isCheckRequest`, `CheckResponse` (types); `splitSentences`; `LruCache`;
  `filterDictionary`; `Settings`, `getSettings`; `detectLang`; `HarperEngine`.
- Produces: `class Orchestrator { constructor(deps: OrchestratorDeps); check(fieldId: string, text: string): Promise<Issue[]> }`
  with `interface OrchestratorDeps { engines: GrammarEngine[]; getSettings(): Promise<Settings>; detect(text: string, fallback: Lang): Promise<Lang>; cacheSize?: number }`.
  Background answers `CheckRequest` messages with `CheckResponse`.

- [ ] **Step 1: Write the failing test**

`tests/background/orchestrator.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { Orchestrator, type OrchestratorDeps } from '@/background/orchestrator';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/settings';
import type { GrammarEngine, Issue } from '@/lib/types';

/** Flags every occurrence of "bad" as a spelling issue. */
function findBad(text: string): Issue[] {
  const issues: Issue[] = [];
  for (let i = text.indexOf('bad'); i !== -1; i = text.indexOf('bad', i + 1)) {
    issues.push({
      id: `x${i}`, start: i, end: i + 3, kind: 'spelling', source: 'harper',
      message: 'bad word', replacements: ['good'], confidence: 'high',
    });
  }
  return issues;
}

function badWordEngine() {
  return {
    id: 'harper' as const,
    supports: (lang: string) => lang === 'en',
    check: vi.fn(async (text: string): Promise<Issue[]> => findBad(text)),
  };
}

function make(engine: GrammarEngine, settings: Partial<Settings> = {}, lang = 'en') {
  const deps: OrchestratorDeps = {
    engines: [engine],
    getSettings: async () => ({ ...DEFAULT_SETTINGS, ...settings }),
    detect: async () => lang,
  };
  return new Orchestrator(deps);
}

describe('Orchestrator', () => {
  it('returns issues with offsets in the full text', async () => {
    const text = 'One bad. Two bad.';
    const issues = await make(badWordEngine()).check('f1', text);
    expect(issues.map((i) => [i.start, i.end])).toEqual([[4, 7], [13, 16]]);
    expect(issues.every((i) => text.slice(i.start, i.end) === 'bad')).toBe(true);
    expect(new Set(issues.map((i) => i.id)).size).toBe(2);
  });

  it('caches results per sentence', async () => {
    const engine = badWordEngine();
    const o = make(engine);
    await o.check('f1', 'One bad. Two bad.');
    expect(engine.check).toHaveBeenCalledTimes(2);
    await o.check('f1', 'One bad. Two bad.');
    expect(engine.check).toHaveBeenCalledTimes(2); // both sentences cached
    await o.check('f1', 'One bad. Three.');
    expect(engine.check).toHaveBeenCalledTimes(3); // only "Three." is new
  });

  it('returns nothing for unsupported languages or when disabled', async () => {
    expect(await make(badWordEngine(), {}, 'de').check('f1', 'Ein bad Satz.')).toEqual([]);
    expect(await make(badWordEngine(), { enabled: false }).check('f1', 'One bad.')).toEqual([]);
  });

  it('applies the personal dictionary', async () => {
    expect(await make(badWordEngine(), { dictionary: ['BAD'] }).check('f1', 'One bad.')).toEqual([]);
  });

  it('abandons an older check for the same field', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const engine = badWordEngine();
    engine.check.mockImplementationOnce(async (text: string) => { await gate; return findBad(text); });
    const o = make(engine);

    const first = o.check('f1', 'One bad.');
    await Promise.resolve();
    const second = o.check('f1', 'Two bad.');
    release();

    expect(await first).toEqual([]);
    expect(await second).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/background`
Expected: FAIL — cannot resolve `@/background/orchestrator`.

- [ ] **Step 3: Implement the orchestrator**

`src/background/orchestrator.ts`:
```ts
import { LruCache } from '@/lib/cache';
import { filterDictionary } from '@/lib/filters';
import { splitSentences } from '@/lib/sentences';
import type { Settings } from '@/lib/settings';
import type { GrammarEngine, Issue, Lang } from '@/lib/types';

export interface OrchestratorDeps {
  engines: GrammarEngine[];
  getSettings(): Promise<Settings>;
  detect(text: string, fallback: Lang): Promise<Lang>;
  cacheSize?: number;
}

export class Orchestrator {
  private readonly cache: LruCache<Issue[]>;
  private readonly inflight = new Map<string, AbortController>();

  constructor(private readonly deps: OrchestratorDeps) {
    this.cache = new LruCache(deps.cacheSize ?? 500);
  }

  async check(fieldId: string, text: string): Promise<Issue[]> {
    this.inflight.get(fieldId)?.abort();
    const ctrl = new AbortController();
    this.inflight.set(fieldId, ctrl);
    try {
      const settings = await this.deps.getSettings();
      if (!settings.enabled) return [];
      const lang = await this.deps.detect(text, settings.defaultLanguage);
      const engine = this.deps.engines.find((e) => e.supports(lang));
      if (!engine) return [];

      const issues: Issue[] = [];
      for (const sentence of splitSentences(text)) {
        const key = `${engine.id}|${lang}|${sentence.text}`;
        let found = this.cache.get(key);
        if (!found) {
          found = await engine.check(sentence.text, lang, ctrl.signal);
          if (ctrl.signal.aborted) return [];
          this.cache.set(key, found);
        }
        for (const issue of found) {
          const start = issue.start + sentence.start;
          const end = issue.end + sentence.start;
          issues.push({ ...issue, id: `${issue.source}-${start}-${end}-${issues.length}`, start, end });
        }
      }
      if (ctrl.signal.aborted) return [];
      return filterDictionary(issues, text, settings.dictionary);
    } finally {
      if (this.inflight.get(fieldId) === ctrl) this.inflight.delete(fieldId);
    }
  }
}
```

Cache keys are the exact sentence text including trailing whitespace (`"One bad. "`), so a sentence is re-checked
only when its own text changes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/background`
Expected: all PASS.

- [ ] **Step 5: Wire the background**

`src/entrypoints/background.ts`:
```ts
import { binary } from 'harper.js/binary';
import { Orchestrator } from '@/background/orchestrator';
import { HarperEngine } from '@/engines/harper';
import { detectLang } from '@/lib/language';
import { getSettings } from '@/lib/settings';
import { isCheckRequest, type CheckResponse } from '@/lib/types';

export default defineBackground(() => {
  const orchestrator = new Orchestrator({
    engines: [new HarperEngine(binary)],
    getSettings,
    detect: (text, fallback) =>
      detectLang(text, fallback, async (t) => {
        const result = await browser.i18n.detectLanguage(t);
        return {
          isReliable: result.isReliable,
          languages: result.languages.map((l) => ({ language: l.language, percentage: l.percentage })),
        };
      }),
  });

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (r: CheckResponse) => void) => {
    if (!isCheckRequest(message)) return false;
    const fieldKey = `${sender.tab?.id ?? 'ext'}:${sender.frameId ?? 0}:${message.fieldId}`;
    orchestrator.check(fieldKey, message.text).then(
      (issues) => sendResponse({ issues }),
      (error) => {
        console.error('[OpenGrammar] check failed', error);
        sendResponse({ issues: [] });
      },
    );
    return true; // keep the channel open for the async response (works in Chromium and Firefox)
  });
});
```

- [ ] **Step 6: Type-check and build**

Run: `npm run compile && npm run build`
Expected: no type errors; `.output/chrome-mv3/` contains `harper_wasm_bg-*.wasm` (or similar hashed name) under `assets/` or `chunks/`.
Check with: `find .output/chrome-mv3 -name '*.wasm'` — expected: exactly one file.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: orchestrator with per-sentence cache and background messaging"
```

---

### Task 5: Field eligibility and text adapters

**Files:**
- Create: `src/content/eligibility.ts`, `src/content/adapters/types.ts`, `src/content/adapters/textarea.ts`, `src/content/adapters/contenteditable.ts`
- Test: `tests/content/eligibility.test.ts`, `tests/content/adapters.test.ts`

**Interfaces:**
- Produces:
  - `findEditable(target: EventTarget | null): HTMLTextAreaElement | HTMLInputElement | HTMLElement | null` (returns the contenteditable **root**)
  - `interface TextRange { start: number; end: number }`
  - `interface TextAdapter { readonly el: HTMLElement; getText(): string; measure(ranges: TextRange[]): DOMRect[][]; replace(range: TextRange, text: string): void; destroy(): void }`
  - `class TextareaAdapter implements TextAdapter { constructor(el: HTMLTextAreaElement | HTMLInputElement) }`
  - `class ContentEditableAdapter implements TextAdapter { constructor(el: HTMLElement) }`
  - `measure()` returns rects in **viewport** coordinates, one array per input range, same order.

- [ ] **Step 1: Write failing tests**

`tests/content/eligibility.test.ts`:
```ts
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { findEditable } from '@/content/eligibility';

beforeEach(() => (document.body.innerHTML = ''));

function html(markup: string): HTMLElement {
  document.body.innerHTML = markup;
  return document.querySelector('[data-t]') as HTMLElement;
}

describe('findEditable', () => {
  it('accepts textareas and text-like inputs', () => {
    expect(findEditable(html('<textarea data-t></textarea>'))).not.toBeNull();
    expect(findEditable(html('<input data-t type="text">'))).not.toBeNull();
    expect(findEditable(html('<input data-t type="search">'))).not.toBeNull();
  });

  it('rejects passwords, emails, read-only and opted-out fields', () => {
    expect(findEditable(html('<input data-t type="password">'))).toBeNull();
    expect(findEditable(html('<input data-t type="email">'))).toBeNull();
    expect(findEditable(html('<textarea data-t readonly></textarea>'))).toBeNull();
    expect(findEditable(html('<div data-gramm="false"><textarea data-t></textarea></div>'))).toBeNull();
  });

  it('returns the contenteditable root for a nested target', () => {
    document.body.innerHTML = '<div id="root" contenteditable="true"><p><b data-t>x</b></p></div>';
    const target = document.querySelector('[data-t]');
    expect(findEditable(target)).toBe(document.getElementById('root'));
  });

  it('rejects code editors', () => {
    expect(findEditable(html('<div class="cm-editor"><div data-t contenteditable="true"></div></div>'))).toBeNull();
  });
});
```

`tests/content/adapters.test.ts`:
```ts
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentEditableAdapter } from '@/content/adapters/contenteditable';
import { TextareaAdapter } from '@/content/adapters/textarea';

beforeEach(() => {
  document.body.innerHTML = '';
  // Force the fallback path so the tests don't depend on execCommand support in happy-dom.
  document.execCommand = () => false;
});

describe('ContentEditableAdapter', () => {
  function editor(markup: string): HTMLElement {
    document.body.innerHTML = `<div contenteditable="true">${markup}</div>`;
    return document.body.firstElementChild as HTMLElement;
  }

  it('flattens blocks and line breaks into text', () => {
    expect(new ContentEditableAdapter(editor('<p>Hello <b>big</b> world</p><p>Second</p>')).getText())
      .toBe('Hello big world\nSecond\n');
    expect(new ContentEditableAdapter(editor('a<br>b')).getText()).toBe('a\nb');
  });

  it('replaces a range inside a nested node and fires input', () => {
    const el = editor('<p>This is <i>teh</i> test</p>');
    const onInput = vi.fn();
    el.addEventListener('input', onInput);
    new ContentEditableAdapter(el).replace({ start: 8, end: 11 }, 'the');
    expect(el.textContent).toBe('This is the test');
    expect(onInput).toHaveBeenCalled();
  });

  it('replaces a range spanning several nodes', () => {
    const el = editor('Hel<b>lo</b> x');
    new ContentEditableAdapter(el).replace({ start: 0, end: 5 }, 'Hi');
    expect(el.textContent).toBe('Hi x');
  });

  it('measures one rect list per range', () => {
    const adapter = new ContentEditableAdapter(editor('<p>one two</p>'));
    expect(adapter.measure([{ start: 0, end: 3 }, { start: 4, end: 7 }])).toHaveLength(2);
  });
});

describe('TextareaAdapter', () => {
  it('reads and replaces text, firing input', () => {
    document.body.innerHTML = '<textarea></textarea>';
    const ta = document.querySelector('textarea')!;
    ta.value = 'This is teh test';
    const onInput = vi.fn();
    ta.addEventListener('input', onInput);
    const adapter = new TextareaAdapter(ta);
    adapter.replace({ start: 8, end: 11 }, 'the');
    expect(adapter.getText()).toBe('This is the test');
    expect(onInput).toHaveBeenCalled();
  });

  it('measures with a single mirror element and removes it on destroy', () => {
    document.body.innerHTML = '<textarea></textarea>';
    const ta = document.querySelector('textarea')!;
    ta.value = 'one two three';
    const adapter = new TextareaAdapter(ta);
    expect(adapter.measure([{ start: 0, end: 3 }, { start: 8, end: 13 }])).toHaveLength(2);
    adapter.measure([{ start: 4, end: 7 }]);
    expect(document.querySelectorAll('[data-og-mirror]')).toHaveLength(1);
    adapter.destroy();
    expect(document.querySelectorAll('[data-og-mirror]')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/content`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/content/eligibility.ts`:
```ts
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url']);
const CODE_EDITORS = '.cm-editor, .CodeMirror, .monaco-editor, .ace_editor';
const OPTED_OUT = '[data-gramm="false"], [data-opengrammar="false"]';

export type Editable = HTMLTextAreaElement | HTMLInputElement | HTMLElement;

export function findEditable(target: EventTarget | null): Editable | null {
  if (!(target instanceof HTMLElement)) return null;

  if (target instanceof HTMLTextAreaElement) {
    return !target.readOnly && !target.disabled && allowed(target) ? target : null;
  }
  if (target instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(target.type) && !target.readOnly && !target.disabled && allowed(target)
      ? target
      : null;
  }
  if (target.isContentEditable) {
    let root: HTMLElement = target;
    while (root.parentElement?.isContentEditable) root = root.parentElement;
    return allowed(root) ? root : null;
  }
  return null;
}

function allowed(el: HTMLElement): boolean {
  return !el.closest(CODE_EDITORS) && !el.closest(OPTED_OUT);
}
```

`src/content/adapters/types.ts`:
```ts
export interface TextRange {
  start: number;
  end: number;
}

/** The only layer that knows about the DOM. Offsets are UTF-16 indices into getText(). */
export interface TextAdapter {
  readonly el: HTMLElement;
  getText(): string;
  /** Viewport-coordinate rects for each range, in input order. Empty array when not visible. */
  measure(ranges: TextRange[]): DOMRect[][];
  /** Replaces the range, keeping the editor's undo history where the browser allows it. */
  replace(range: TextRange, text: string): void;
  destroy(): void;
}

export function insertText(text: string): boolean {
  try {
    return typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
  } catch {
    return false;
  }
}
```

`src/content/adapters/textarea.ts`:
```ts
import { insertText, type TextAdapter, type TextRange } from './types';

const MIRRORED = [
  'box-sizing', 'width', 'height',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'font-family', 'font-size', 'font-style', 'font-variant', 'font-weight', 'font-stretch',
  'letter-spacing', 'line-height', 'text-transform', 'text-indent', 'text-align', 'word-spacing',
  'tab-size', 'direction', 'overflow-wrap', 'word-break',
];

/** Measures text positions by laying the same text out in a hidden div that copies the field's styles. */
export class TextareaAdapter implements TextAdapter {
  private mirror: HTMLDivElement | null = null;

  constructor(readonly el: HTMLTextAreaElement | HTMLInputElement) {}

  getText(): string {
    return this.el.value;
  }

  measure(ranges: TextRange[]): DOMRect[][] {
    if (ranges.length === 0) return [];
    const mirror = this.ensureMirror();
    const text = this.el.value;
    const spans: HTMLSpanElement[] = [];
    const order = ranges.map((r, i) => ({ ...r, i })).sort((a, b) => a.start - b.start);

    mirror.textContent = '';
    let pos = 0;
    for (const r of order) {
      const start = Math.max(r.start, pos);
      const end = Math.max(r.end, start);
      mirror.append(text.slice(pos, start));
      const span = document.createElement('span');
      span.textContent = text.slice(start, end);
      mirror.append(span);
      spans[r.i] = span;
      pos = end;
    }
    mirror.append(`${text.slice(pos)}​`);
    this.syncGeometry(mirror);
    return spans.map((span) => Array.from(span.getClientRects()));
  }

  replace({ start, end }: TextRange, text: string): void {
    const el = this.el;
    el.focus();
    el.setSelectionRange(start, end);
    if (!insertText(text)) {
      el.setRangeText(text, start, end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  destroy(): void {
    this.mirror?.remove();
    this.mirror = null;
  }

  private ensureMirror(): HTMLDivElement {
    if (!this.mirror) {
      this.mirror = document.createElement('div');
      this.mirror.dataset.ogMirror = '';
      this.mirror.setAttribute('aria-hidden', 'true');
      (document.body ?? document.documentElement).append(this.mirror);
    }
    return this.mirror;
  }

  private syncGeometry(mirror: HTMLDivElement): void {
    const el = this.el;
    const cs = getComputedStyle(el);
    for (const prop of MIRRORED) mirror.style.setProperty(prop, cs.getPropertyValue(prop));

    const box = el.getBoundingClientRect();
    const isTextarea = el instanceof HTMLTextAreaElement;
    mirror.style.setProperty('position', 'fixed');
    mirror.style.setProperty('left', `${box.left}px`);
    mirror.style.setProperty('top', `${box.top}px`);
    mirror.style.setProperty('margin', '0');
    mirror.style.setProperty('visibility', 'hidden');
    mirror.style.setProperty('pointer-events', 'none');
    mirror.style.setProperty('border-color', 'transparent');
    mirror.style.setProperty('white-space', isTextarea ? 'pre-wrap' : 'pre');
    mirror.style.setProperty('overflow-x', 'hidden');
    // Match the field's scrollbar so wrapping width is identical.
    mirror.style.setProperty('overflow-y', isTextarea && el.scrollHeight > el.clientHeight ? 'scroll' : 'hidden');
    if (!isTextarea) {
      // Inputs centre a single line vertically.
      const inner = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      mirror.style.setProperty('line-height', `${inner}px`);
    }
    mirror.scrollTop = el.scrollTop;
    mirror.scrollLeft = el.scrollLeft;
  }
}
```

`src/content/adapters/contenteditable.ts`:
```ts
import { insertText, type TextAdapter, type TextRange } from './types';

const BLOCKS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE', 'FOOTER',
  'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL',
]);
const SKIPPED = new Set(['SCRIPT', 'STYLE', 'TEMPLATE']);

interface Segment {
  node: Text;
  start: number;
}

export class ContentEditableAdapter implements TextAdapter {
  private segments: Segment[] = [];
  private text = '';

  constructor(readonly el: HTMLElement) {}

  getText(): string {
    this.rebuild();
    return this.text;
  }

  measure(ranges: TextRange[]): DOMRect[][] {
    this.rebuild();
    return ranges.map((r) => {
      const range = this.toDomRange(r);
      return range ? Array.from(range.getClientRects()) : [];
    });
  }

  replace(r: TextRange, text: string): void {
    this.rebuild();
    const range = this.toDomRange(r);
    if (!range) return;
    this.el.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (!insertText(text)) {
      range.deleteContents();
      if (text !== '') range.insertNode(document.createTextNode(text));
      this.el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  destroy(): void {}

  private rebuild(): void {
    const segments: Segment[] = [];
    let text = '';
    const newline = () => {
      if (text !== '' && !text.endsWith('\n')) text += '\n';
    };
    const visit = (node: Node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const t = child as Text;
          if (t.data !== '') {
            segments.push({ node: t, start: text.length });
            text += t.data;
          }
        } else if (child instanceof HTMLBRElement) {
          text += '\n';
        } else if (child instanceof HTMLElement && !SKIPPED.has(child.tagName)) {
          const block = BLOCKS.has(child.tagName);
          if (block) newline();
          visit(child);
          if (block) newline();
        }
      }
    };
    visit(this.el);
    this.segments = segments;
    this.text = text;
  }

  private pointAt(offset: number, bias: 'start' | 'end'): { node: Text; offset: number } | null {
    for (const seg of this.segments) {
      const segEnd = seg.start + seg.node.data.length;
      const inside = bias === 'start'
        ? offset >= seg.start && offset < segEnd
        : offset > seg.start && offset <= segEnd;
      if (inside) return { node: seg.node, offset: offset - seg.start };
    }
    return null;
  }

  private toDomRange({ start, end }: TextRange): Range | null {
    const a = this.pointAt(start, 'start');
    const b = this.pointAt(end, 'end');
    if (!a || !b) return null;
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    return range;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/content`
Expected: all PASS. If happy-dom lacks `isContentEditable`, the eligibility contenteditable tests fail — in that case
replace `x.isContentEditable` in `eligibility.ts` with a helper `isEditable(x) = x.isContentEditable ?? x.closest('[contenteditable=""],[contenteditable="true"]') !== null`
and rerun (real browsers always implement `isContentEditable`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: field eligibility plus textarea and contenteditable text adapters"
```

---

### Task 6: Overlay, suggestion card and field session

**Files:**
- Create: `src/content/card.ts`, `src/content/overlay.ts`, `src/content/session.ts`
- Test: `tests/content/overlay.test.ts`, `tests/content/session.test.ts`

**Interfaces:**
- Consumes: `Issue`, `IssueKind`; `TextAdapter`; `rebaseIssues`; `ignoreKey`.
- Produces:
  - `interface Mark { issue: Issue; rects: DOMRect[] }`
  - `class Overlay { readonly root: ShadowRoot; draw(fieldId: string, marks: Mark[], clip: DOMRect): void; clear(fieldId: string): void }` —
    host element `<opengrammar-overlay>`, open shadow root, lines carry `data-og-underline="<kind>"` and `data-issue-id`.
  - `interface CardActions { onApply(replacement: string): void; onIgnore(): void; onAddToDictionary?: () => void }`
  - `class SuggestionCard { constructor(root: ShadowRoot); show(issue: Issue, original: string, anchor: DOMRect, actions: CardActions): void; hide(): void; containsEvent(e: Event): boolean }` —
    card has `data-og-card`, fix buttons have class `og-fix`.
  - `interface SessionDeps { overlay: Pick<Overlay, 'draw'|'clear'>; card: Pick<SuggestionCard, 'show'|'hide'>; check(fieldId: string, text: string): Promise<Issue[]>; addToDictionary(word: string): Promise<void>; onDispose?: () => void; debounceMs?: number }`
  - `class FieldSession { readonly id: string; constructor(adapter: TextAdapter, deps: SessionDeps); recheck(): void; render(): void; destroy(): void }`

- [ ] **Step 1: Write failing tests**

`tests/content/overlay.test.ts`:
```ts
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SuggestionCard } from '@/content/card';
import { Overlay } from '@/content/overlay';
import type { Issue } from '@/lib/types';

const issue = (over: Partial<Issue> = {}): Issue => ({
  id: 'a', start: 0, end: 3, kind: 'spelling', source: 'harper',
  message: 'Did you mean “the”?', replacements: ['the', 'tea'], confidence: 'high', ...over,
});
const clip = new DOMRect(0, 0, 500, 200);

beforeEach(() => (document.documentElement.innerHTML = '<head></head><body></body>'));

describe('Overlay', () => {
  it('draws one line per visible rect and skips clipped ones', () => {
    const overlay = new Overlay();
    overlay.draw('f1', [
      { issue: issue(), rects: [new DOMRect(10, 10, 30, 16)] },
      { issue: issue({ id: 'b', confidence: 'low', kind: 'wording' }), rects: [new DOMRect(10, 40, 30, 16)] },
      { issue: issue({ id: 'c' }), rects: [new DOMRect(600, 10, 30, 16)] },
    ], clip);
    const lines = overlay.root.querySelectorAll<HTMLElement>('[data-og-underline]');
    expect(lines).toHaveLength(2);
    expect(lines[0].dataset.issueId).toBe('a');
    expect(lines[1].classList.contains('og-low')).toBe(true);
  });

  it('redraws and clears per field', () => {
    const overlay = new Overlay();
    overlay.draw('f1', [{ issue: issue(), rects: [new DOMRect(10, 10, 30, 16)] }], clip);
    overlay.draw('f1', [], clip);
    expect(overlay.root.querySelectorAll('[data-og-underline]')).toHaveLength(0);
    overlay.draw('f1', [{ issue: issue(), rects: [new DOMRect(10, 10, 30, 16)] }], clip);
    overlay.clear('f1');
    expect(overlay.root.querySelectorAll('[data-og-underline]')).toHaveLength(0);
  });
});

describe('SuggestionCard', () => {
  it('shows fixes and dictionary action, and applies a fix', () => {
    const overlay = new Overlay();
    const card = new SuggestionCard(overlay.root);
    const onApply = vi.fn();
    card.show(issue(), 'teh', new DOMRect(10, 10, 30, 16), { onApply, onIgnore: vi.fn(), onAddToDictionary: vi.fn() });
    const fixes = overlay.root.querySelectorAll<HTMLButtonElement>('.og-fix');
    expect(Array.from(fixes, (b) => b.textContent)).toEqual(['the', 'tea']);
    expect(overlay.root.querySelector('.og-dict')).not.toBeNull();
    fixes[0].click();
    expect(onApply).toHaveBeenCalledWith('the');
    expect(overlay.root.querySelector('[data-og-card]')).toBeNull();
  });

  it('omits the dictionary action when not offered', () => {
    const overlay = new Overlay();
    new SuggestionCard(overlay.root).show(issue(), 'teh', new DOMRect(), { onApply: vi.fn(), onIgnore: vi.fn() });
    expect(overlay.root.querySelector('.og-dict')).toBeNull();
  });
});
```

`tests/content/session.test.ts`:
```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextAdapter, TextRange } from '@/content/adapters/types';
import { FieldSession, type SessionDeps } from '@/content/session';
import type { Issue } from '@/lib/types';

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const RECT = new DOMRect(10, 10, 30, 16);

function fakeAdapter(initial: string): TextAdapter & { type(text: string): void } {
  const el = document.createElement('textarea');
  el.value = initial;
  document.body.append(el);
  return {
    el,
    getText: () => el.value,
    measure: (ranges: TextRange[]) => ranges.map(() => [RECT]),
    replace: ({ start, end }, text) => {
      el.value = el.value.slice(0, start) + text + el.value.slice(end);
      el.dispatchEvent(new Event('input'));
    },
    destroy: () => {},
    type(text: string) {
      el.value = text;
      el.dispatchEvent(new Event('input'));
    },
  };
}

const issueAt = (text: string, word: string): Issue => {
  const start = text.indexOf(word);
  return {
    id: word, start, end: start + word.length, kind: 'spelling', source: 'harper',
    message: 'typo', replacements: ['the'], confidence: 'high',
  };
};

function deps(check: SessionDeps['check']) {
  return {
    overlay: { draw: vi.fn(), clear: vi.fn() },
    card: { show: vi.fn(), hide: vi.fn() },
    check: vi.fn(check),
    addToDictionary: vi.fn(async () => {}),
  };
}

const lastMarks = (d: ReturnType<typeof deps>) => d.overlay.draw.mock.calls.at(-1)?.[1] ?? [];

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('FieldSession', () => {
  it('checks on start and draws the issues', async () => {
    const d = deps(async (_id, text) => [issueAt(text, 'teh')]);
    new FieldSession(fakeAdapter('This is teh test'), d);
    await vi.runAllTimersAsync();
    expect(d.check).toHaveBeenCalledTimes(1);
    expect(lastMarks(d)).toHaveLength(1);
  });

  it('debounces typing and drops stale results', async () => {
    let releaseFirst!: (v: Issue[]) => void;
    const d = deps(async () => []);
    d.check
      .mockImplementationOnce(() => new Promise<Issue[]>((r) => (releaseFirst = r)))
      .mockImplementationOnce(async (_id, text) => [issueAt(text, 'tset')]);
    const adapter = fakeAdapter('This is teh test');
    new FieldSession(adapter, d);
    await vi.advanceTimersByTimeAsync(0); // first check in flight

    adapter.type('This is a tset');
    adapter.type('This is a tset!');
    await vi.advanceTimersByTimeAsync(300);
    expect(d.check).toHaveBeenCalledTimes(2);

    releaseFirst([issueAt('This is teh test', 'teh')]); // stale: must be ignored
    await vi.runAllTimersAsync();
    expect(lastMarks(d).map((m: { issue: Issue }) => m.issue.id)).toEqual(['tset']);
  });

  it('immediately hides an issue the user is editing', async () => {
    const d = deps(async (_id, text) => [issueAt(text, 'teh')]);
    const adapter = fakeAdapter('This is teh test');
    new FieldSession(adapter, d);
    await vi.runAllTimersAsync();
    adapter.type('This is tehh test');
    expect(lastMarks(d)).toHaveLength(0);
  });

  it('opens the card on click and hides an ignored issue', async () => {
    const d = deps(async (_id, text) => [issueAt(text, 'teh')]);
    const adapter = fakeAdapter('This is teh test');
    new FieldSession(adapter, d);
    await vi.runAllTimersAsync();

    adapter.el.dispatchEvent(new MouseEvent('click', { clientX: 20, clientY: 20 }));
    expect(d.card.show).toHaveBeenCalledTimes(1);
    const actions = d.card.show.mock.calls[0][3];
    expect(actions.onAddToDictionary).toBeTypeOf('function');

    actions.onIgnore();
    expect(lastMarks(d)).toHaveLength(0);
  });

  it('adds a word to the dictionary', async () => {
    const d = deps(async (_id, text) => [issueAt(text, 'teh')]);
    const adapter = fakeAdapter('This is teh test');
    new FieldSession(adapter, d);
    await vi.runAllTimersAsync();
    adapter.el.dispatchEvent(new MouseEvent('click', { clientX: 20, clientY: 20 }));
    d.card.show.mock.calls[0][3].onAddToDictionary();
    expect(d.addToDictionary).toHaveBeenCalledWith('teh');
    expect(lastMarks(d)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/content/overlay.test.ts tests/content/session.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the card**

`src/content/card.ts`:
```ts
import type { Issue } from '@/lib/types';

export interface CardActions {
  onApply(replacement: string): void;
  onIgnore(): void;
  onAddToDictionary?: () => void;
}

export const CARD_CSS = `
.og-card {
  position: fixed; width: 280px; box-sizing: border-box; padding: 12px;
  background: #fff; color: #1c2024; border: 1px solid #dfe3e6; border-radius: 10px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.14); pointer-events: auto;
  font: 14px/1.4 system-ui, sans-serif;
}
.og-msg { margin: 0 0 10px; }
.og-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.og-card button {
  font: inherit; cursor: pointer; border-radius: 6px; padding: 4px 10px;
  border: 1px solid #dfe3e6; background: transparent; color: inherit;
}
.og-card button.og-fix { background: #3e63dd; border-color: #3e63dd; color: #fff; font-weight: 600; }
@media (prefers-color-scheme: dark) {
  .og-card { background: #1c2024; color: #edeef0; border-color: #363a3f; }
  .og-card button { border-color: #363a3f; }
}
`;

export class SuggestionCard {
  private el: HTMLDivElement | null = null;

  constructor(private readonly root: ShadowRoot) {}

  show(issue: Issue, original: string, anchor: DOMRect, actions: CardActions): void {
    this.hide();
    const card = document.createElement('div');
    card.className = 'og-card';
    card.dataset.ogCard = '';
    // Keep focus (and the caret) in the field while clicking the card.
    card.addEventListener('mousedown', (e) => e.preventDefault());

    const message = document.createElement('p');
    message.className = 'og-msg';
    message.textContent = issue.message;

    const row = document.createElement('div');
    row.className = 'og-actions';
    for (const replacement of issue.replacements.slice(0, 3)) {
      const label = replacement === '' ? `Remove “${original}”` : replacement;
      row.append(this.button(label, 'og-fix', () => actions.onApply(replacement)));
    }
    row.append(this.button('Ignore', 'og-ignore', actions.onIgnore));
    if (actions.onAddToDictionary) {
      row.append(this.button('Add to dictionary', 'og-dict', actions.onAddToDictionary));
    }

    card.append(message, row);
    card.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - 288))}px`;
    card.style.top = `${anchor.bottom + 6}px`;
    this.root.append(card);
    this.el = card;
  }

  hide(): void {
    this.el?.remove();
    this.el = null;
  }

  containsEvent(event: Event): boolean {
    return this.el !== null && event.composedPath().includes(this.el);
  }

  private button(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = label;
    b.addEventListener('click', () => {
      this.hide();
      onClick();
    });
    return b;
  }
}
```

- [ ] **Step 4: Implement the overlay**

`src/content/overlay.ts`:
```ts
import type { Issue, IssueKind } from '@/lib/types';
import { CARD_CSS } from './card';

export interface Mark {
  issue: Issue;
  rects: DOMRect[];
}

const COLORS: Record<IssueKind, string> = {
  spelling: '#e5484d',
  grammar: '#3e63dd',
  style: '#3e63dd',
  wording: '#8e4ec6',
};

const CSS = `
.og-line { position: fixed; height: 0; border-bottom: 2px solid var(--og-color); pointer-events: none; }
.og-line.og-low { border-bottom-style: dotted; }
${CARD_CSS}`;

/** One fixed, click-through layer per page; underlines are drawn in viewport coordinates. */
export class Overlay {
  readonly root: ShadowRoot;
  private readonly layers = new Map<string, HTMLDivElement>();

  constructor() {
    const host = document.createElement('opengrammar-overlay');
    host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;';
    this.root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    this.root.append(style);
    document.documentElement.append(host);
  }

  draw(fieldId: string, marks: Mark[], clip: DOMRect): void {
    let layer = this.layers.get(fieldId);
    if (!layer) {
      layer = document.createElement('div');
      layer.dataset.ogField = fieldId;
      this.root.append(layer);
      this.layers.set(fieldId, layer);
    }
    const lines: HTMLDivElement[] = [];
    for (const { issue, rects } of marks) {
      for (const r of rects) {
        const left = Math.max(r.left, clip.left);
        const right = Math.min(r.right, clip.right);
        if (right <= left || r.bottom < clip.top || r.bottom > clip.bottom + 2) continue;
        const line = document.createElement('div');
        line.className = issue.confidence === 'low' ? 'og-line og-low' : 'og-line';
        line.dataset.ogUnderline = issue.kind;
        line.dataset.issueId = issue.id;
        line.style.cssText = `left:${left}px;top:${r.bottom - 2}px;width:${right - left}px;--og-color:${COLORS[issue.kind]}`;
        lines.push(line);
      }
    }
    layer.replaceChildren(...lines);
  }

  clear(fieldId: string): void {
    this.layers.get(fieldId)?.remove();
    this.layers.delete(fieldId);
  }
}
```

- [ ] **Step 5: Implement the session**

`src/content/session.ts`:
```ts
import { ignoreKey } from '@/lib/filters';
import { rebaseIssues } from '@/lib/rebase';
import type { Issue } from '@/lib/types';
import type { TextAdapter } from './adapters/types';
import type { SuggestionCard } from './card';
import type { Mark, Overlay } from './overlay';

export interface SessionDeps {
  overlay: Pick<Overlay, 'draw' | 'clear'>;
  card: Pick<SuggestionCard, 'show' | 'hide'>;
  check(fieldId: string, text: string): Promise<Issue[]>;
  addToDictionary(word: string): Promise<void>;
  onDispose?: () => void;
  debounceMs?: number;
}

let nextId = 0;

/** Owns one editable field: keeps issues in sync with its text and draws them. */
export class FieldSession {
  readonly id = `og-field-${++nextId}`;
  private text: string;
  private issues: Issue[] = [];
  private marks: Mark[] = [];
  private readonly ignored = new Set<string>();
  private version = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposers: (() => void)[] = [];
  private disposed = false;

  constructor(private readonly adapter: TextAdapter, private readonly deps: SessionDeps) {
    const el = adapter.el;
    this.text = adapter.getText();
    this.listen(el, 'input', () => this.onInput());
    this.listen(el, 'scroll', () => this.render());
    this.listen(el, 'click', (e) => this.onClick(e as MouseEvent));
    this.listen(window, 'scroll', () => this.render(), true);
    this.listen(window, 'resize', () => this.render());
    const observer = new ResizeObserver(() => this.render());
    observer.observe(el);
    this.disposers.push(() => observer.disconnect());
    this.schedule(0);
  }

  recheck(): void {
    this.schedule(0);
  }

  render(): void {
    if (this.disposed) return;
    if (!this.adapter.el.isConnected) {
      this.destroy();
      return;
    }
    const visible = this.issues.filter((i) => !this.ignored.has(ignoreKey(this.text, i)));
    const rects = this.adapter.measure(visible);
    this.marks = visible.map((issue, k) => ({ issue, rects: rects[k] ?? [] }));
    this.deps.overlay.draw(this.id, this.marks, this.adapter.el.getBoundingClientRect());
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    for (const dispose of this.disposers) dispose();
    this.deps.overlay.clear(this.id);
    this.adapter.destroy();
    this.deps.onDispose?.();
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void, capture = false): void {
    target.addEventListener(type, fn, capture);
    this.disposers.push(() => target.removeEventListener(type, fn, capture));
  }

  private onInput(): void {
    const next = this.adapter.getText();
    this.issues = rebaseIssues(this.issues, this.text, next);
    this.text = next;
    this.deps.card.hide();
    this.render();
    this.schedule(this.deps.debounceMs ?? 300);
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), ms);
  }

  private async run(): Promise<void> {
    const version = ++this.version;
    const text = this.adapter.getText();
    let issues: Issue[];
    try {
      issues = await this.deps.check(this.id, text);
    } catch {
      return;
    }
    if (this.disposed || version !== this.version || text !== this.adapter.getText()) return;
    this.text = text;
    this.issues = issues;
    this.render();
  }

  private onClick(e: MouseEvent): void {
    const hit = this.marks.find((m) =>
      m.rects.some((r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom + 3),
    );
    if (!hit) return;
    const { issue } = hit;
    const original = this.text.slice(issue.start, issue.end);
    const hide = () => {
      this.ignored.add(ignoreKey(this.text, issue));
      this.render();
    };
    this.deps.card.show(issue, original, hit.rects[0], {
      onApply: (replacement) => this.adapter.replace(issue, replacement),
      onIgnore: hide,
      onAddToDictionary: issue.kind === 'spelling'
        ? () => {
            void this.deps.addToDictionary(original);
            hide();
          }
        : undefined,
    });
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/content`
Expected: all PASS.

- [ ] **Step 7: Run the whole suite and type-check**

Run: `npm test && npm run compile`
Expected: all tests PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: underline overlay, suggestion card and per-field session"
```

---

### Task 7: Content script wiring and end-to-end tests

**Files:**
- Create: `src/entrypoints/content.ts`, `playwright.config.ts`, `e2e/fixtures.ts`, `e2e/fixtures/page.html`, `e2e/grammar.spec.ts`
- Modify: `.gitignore` (already ignores `test-results`, `playwright-report`)

**Interfaces:**
- Consumes: `findEditable`, `TextareaAdapter`, `ContentEditableAdapter`, `Overlay`, `SuggestionCard`, `FieldSession`,
  `getSettings`, `watchSettings`, `addToDictionary`, `isSiteIgnored`, `CheckRequest`, `CheckResponse`.
- Produces: e2e fixtures `test`/`expect` with `page`, `context`, `extensionWorker: Worker`, `site: string` (base URL of
  the fixture page on `127.0.0.1`), reused by Task 8.

- [ ] **Step 1: Write the content script**

`src/entrypoints/content.ts`:
```ts
import { ContentEditableAdapter } from '@/content/adapters/contenteditable';
import { TextareaAdapter } from '@/content/adapters/textarea';
import type { TextAdapter } from '@/content/adapters/types';
import { SuggestionCard } from '@/content/card';
import { findEditable, type Editable } from '@/content/eligibility';
import { Overlay } from '@/content/overlay';
import { FieldSession } from '@/content/session';
import { addToDictionary, getSettings, isSiteIgnored, watchSettings } from '@/lib/settings';
import type { CheckRequest, CheckResponse, Issue } from '@/lib/types';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  async main(ctx) {
    let settings = await getSettings();
    const overlay = new Overlay();
    const card = new SuggestionCard(overlay.root);
    const sessions = new Map<Editable, FieldSession>();
    const active = () => settings.enabled && !isSiteIgnored(location.hostname, settings.ignoredSites);

    const check = async (fieldId: string, text: string): Promise<Issue[]> => {
      const request: CheckRequest = { type: 'og:check', fieldId, text };
      const response = (await browser.runtime.sendMessage(request)) as CheckResponse | undefined;
      return response?.issues ?? [];
    };

    const attach = (target: EventTarget | null) => {
      if (!active()) return;
      const el = findEditable(target);
      if (!el || sessions.has(el)) return;
      const adapter: TextAdapter =
        el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
          ? new TextareaAdapter(el)
          : new ContentEditableAdapter(el);
      sessions.set(el, new FieldSession(adapter, {
        overlay, card, check, addToDictionary,
        onDispose: () => sessions.delete(el),
      }));
    };

    const destroyAll = () => {
      for (const session of [...sessions.values()]) session.destroy();
      card.hide();
    };

    document.addEventListener('focusin', (e) => attach(e.target), true);
    document.addEventListener('mousedown', (e) => { if (!card.containsEvent(e)) card.hide(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') card.hide(); }, true);

    const unwatch = watchSettings((next) => {
      settings = next;
      if (!active()) destroyAll();
      else for (const session of sessions.values()) session.recheck();
    });

    attach(document.activeElement);
    ctx.onInvalidated(() => {
      unwatch();
      destroyAll();
    });
  },
});
```

- [ ] **Step 2: Build and check the bundle split**

Run: `npm run build && ls -la .output/chrome-mv3/content-scripts/`
Expected: `content.js` well under 100 KB and it contains no Harper code. Verify: `grep -c harper_wasm .output/chrome-mv3/content-scripts/content.js` → `0`.

- [ ] **Step 3: Write the e2e fixtures**

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  workers: 1,
  use: { trace: 'retain-on-failure' },
});
```

`e2e/fixtures/page.html`:
```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>OpenGrammar fixture</title></head>
  <body style="font: 16px/1.5 sans-serif; padding: 24px">
    <textarea id="ta" rows="4" cols="60"></textarea>
    <div id="ce" contenteditable="true" style="border: 1px solid #999; min-height: 60px; margin-top: 16px; padding: 4px"></div>
  </body>
</html>
```

`e2e/fixtures.ts`:
```ts
import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const EXTENSION = path.resolve('.output/chrome-mv3');
const PAGE = fs.readFileSync(path.resolve('e2e/fixtures/page.html'));

export const test = base.extend<{ context: BrowserContext; extensionWorker: Worker; site: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    await use(context);
    await context.close();
  },
  extensionWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
  site: async ({}, use) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await use(`http://127.0.0.1:${port}/`);
    server.close();
  },
});

export const expect = test.expect;

export const underlines = (kind: string) => `opengrammar-overlay [data-og-underline="${kind}"]`;
```

- [ ] **Step 4: Write the e2e tests**

`e2e/grammar.spec.ts`:
```ts
import { expect, test, underlines } from './fixtures';

test('underlines a typo in a textarea and applies the fix', async ({ page, site }) => {
  await page.goto(site);
  const ta = page.locator('#ta');
  await ta.click();
  await ta.pressSequentially('This is teh test.');

  const line = page.locator(underlines('spelling'));
  await expect(line).toHaveCount(1, { timeout: 10_000 });
  const box = (await line.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y);

  await page.locator('opengrammar-overlay [data-og-card]').getByRole('button', { name: 'the', exact: true }).click();
  await expect(ta).toHaveValue('This is the test.');
  await expect(line).toHaveCount(0);
});

test('underlines grammar in a contenteditable editor', async ({ page, site }) => {
  await page.goto(site);
  const ce = page.locator('#ce');
  await ce.click();
  await ce.pressSequentially('I has a apple.');
  await expect(page.locator(underlines('grammar')).first()).toBeVisible({ timeout: 10_000 });
});
```

- [ ] **Step 5: Run the e2e tests**

Run:
```bash
npx playwright install chromium
npm run e2e
```
Expected: 2 tests PASS.
If `extensionWorker`/messaging fails with "Could not establish connection", open `chrome://extensions` in a headed run
(`npx playwright test --headed`) and read the service worker console — the usual cause is the WASM CSP; confirm
`.output/chrome-mv3/manifest.json` contains `'wasm-unsafe-eval'`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: content script wiring with Playwright end-to-end tests"
```

---

### Task 8: Popup, options page, dictionary and ignored-site e2e, Firefox smoke

**Files:**
- Create: `src/assets/page.css`, `src/entrypoints/popup/index.html`, `src/entrypoints/popup/main.ts`,
  `src/entrypoints/options/index.html`, `src/entrypoints/options/main.ts`, `e2e/settings.spec.ts`
- Create: `README.md`

**Interfaces:**
- Consumes: `getSettings`, `updateSettings`, `watchSettings`, `isSiteIgnored`, `normalizeSite`, `Settings`; e2e fixtures from Task 7.
- Produces: popup with `#enabled`, `#site-enabled`, `#site`, `#open-options`; options page with sections
  `[data-list="dictionary"]` and `[data-list="ignoredSites"]`, each holding a `form` (input `name="value"`) and a `ul`.

- [ ] **Step 1: Write the failing e2e tests**

`e2e/settings.spec.ts`:
```ts
import { expect, test, underlines } from './fixtures';

test('adding a word to the dictionary removes its underline and persists', async ({ page, site }) => {
  await page.goto(site);
  const ta = page.locator('#ta');
  await ta.click();
  await ta.pressSequentially('Zorblax is here.');

  const line = page.locator(underlines('spelling'));
  await expect(line).toHaveCount(1, { timeout: 10_000 });
  const box = (await line.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y);
  await page.locator('opengrammar-overlay [data-og-card]').getByRole('button', { name: 'Add to dictionary' }).click();
  await expect(line).toHaveCount(0);

  await page.reload();
  await page.locator('#ta').click();
  await page.locator('#ta').pressSequentially('Zorblax is here.');
  await page.waitForTimeout(1500);
  await expect(line).toHaveCount(0);
});

test('ignored sites get no underlines', async ({ page, site, extensionWorker }) => {
  await extensionWorker.evaluate(() => chrome.storage.local.set({ settings: { ignoredSites: ['127.0.0.1'] } }));
  await page.goto(site);
  await page.locator('#ta').click();
  await page.locator('#ta').pressSequentially('This is teh test.');
  await page.waitForTimeout(1500);
  await expect(page.locator(underlines('spelling'))).toHaveCount(0);
});

test('options page lists and removes dictionary words', async ({ page, extensionWorker }) => {
  await extensionWorker.evaluate(() => chrome.storage.local.set({ settings: { dictionary: ['Zorblax'] } }));
  const id = new URL(extensionWorker.url()).host;
  await page.goto(`chrome-extension://${id}/options.html`);
  const list = page.locator('[data-list="dictionary"] ul');
  await expect(list).toContainText('Zorblax');
  await list.getByRole('button', { name: 'Remove' }).click();
  await expect(list).not.toContainText('Zorblax');

  const sites = page.locator('[data-list="ignoredSites"]');
  await sites.locator('input[name="value"]').fill('https://Reddit.com/r/x');
  await sites.getByRole('button', { name: 'Add' }).click();
  await expect(sites.locator('ul')).toContainText('reddit.com');
});
```

Note: `extensionWorker.evaluate` runs in the service worker, where `chrome` is the global — the e2e tsconfig does not
need extension types because Playwright serialises the function; if `tsc` complains, add `declare const chrome: any;`
at the top of the file.

- [ ] **Step 2: Run to verify the options test fails**

Run: `npm run e2e -- e2e/settings.spec.ts`
Expected: the two content tests PASS already (dictionary and ignore logic exist since Task 6–7); the options test FAILS
with a navigation error because `options.html` does not exist yet.

- [ ] **Step 3: Write the shared page styles**

`src/assets/page.css`:
```css
:root {
  --bg: #ffffff; --fg: #1c2024; --muted: #60646c; --line: #dfe3e6; --accent: #3e63dd;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #111113; --fg: #edeef0; --muted: #b0b4ba; --line: #363a3f; --accent: #6e8bff; }
}
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, sans-serif; }
main { padding: 16px; display: grid; gap: 12px; }
h1 { font-size: 16px; margin: 0; }
h2 { font-size: 14px; margin: 0 0 6px; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.muted { color: var(--muted); }
a { color: var(--accent); }
button, input { font: inherit; }
button { border: 1px solid var(--line); background: transparent; color: inherit; border-radius: 6px; padding: 2px 10px; cursor: pointer; }
input[type="text"] { border: 1px solid var(--line); background: transparent; color: inherit; border-radius: 6px; padding: 4px 8px; flex: 1; }
ul { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 4px; }
li { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--line); padding: 4px 0; }
form { display: flex; gap: 8px; }
```

- [ ] **Step 4: Write the popup**

`src/entrypoints/popup/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>OpenGrammar</title>
    <style>body { width: 300px; }</style>
  </head>
  <body>
    <main>
      <h1>OpenGrammar</h1>
      <label class="row"><span>Enabled</span><input type="checkbox" id="enabled" /></label>
      <label class="row" id="site-row"><span>Check on <b id="site"></b></span><input type="checkbox" id="site-enabled" /></label>
      <a href="#" id="open-options">Dictionary &amp; ignored sites</a>
    </main>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`src/entrypoints/popup/main.ts`:
```ts
import '@/assets/page.css';
import { getSettings, isSiteIgnored, updateSettings } from '@/lib/settings';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname : null;
  } catch {
    return null;
  }
}

async function init() {
  const settings = await getSettings();
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const host = hostOf(tab?.url);

  const enabled = byId<HTMLInputElement>('enabled');
  enabled.checked = settings.enabled;
  enabled.addEventListener('change', () => void updateSettings({ enabled: enabled.checked }));

  const siteRow = byId<HTMLLabelElement>('site-row');
  if (!host) {
    siteRow.hidden = true;
  } else {
    byId('site').textContent = host;
    const siteEnabled = byId<HTMLInputElement>('site-enabled');
    siteEnabled.checked = !isSiteIgnored(host, settings.ignoredSites);
    siteEnabled.addEventListener('change', async () => {
      const { ignoredSites } = await getSettings();
      await updateSettings({
        ignoredSites: siteEnabled.checked
          ? ignoredSites.filter((site) => !isSiteIgnored(host, [site]))
          : [...new Set([...ignoredSites, host])],
      });
    });
  }

  byId('open-options').addEventListener('click', (e) => {
    e.preventDefault();
    void browser.runtime.openOptionsPage();
  });
}

void init();
```

- [ ] **Step 5: Write the options page**

`src/entrypoints/options/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="manifest.open_in_tab" content="true" />
    <title>OpenGrammar settings</title>
    <style>main { max-width: 560px; margin: 0 auto; }</style>
  </head>
  <body>
    <main>
      <h1>OpenGrammar settings</h1>
      <section data-list="dictionary">
        <h2>Personal dictionary</h2>
        <p class="muted">Words here are never flagged as spelling mistakes.</p>
        <form><input type="text" name="value" placeholder="Add a word" /><button type="submit">Add</button></form>
        <ul></ul>
      </section>
      <section data-list="ignoredSites">
        <h2>Ignored sites</h2>
        <p class="muted">OpenGrammar stays off on these sites and their subdomains.</p>
        <form><input type="text" name="value" placeholder="example.com" /><button type="submit">Add</button></form>
        <ul></ul>
      </section>
    </main>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`src/entrypoints/options/main.ts`:
```ts
import '@/assets/page.css';
import { getSettings, normalizeSite, updateSettings, watchSettings, type Settings } from '@/lib/settings';

type ListKey = 'dictionary' | 'ignoredSites';

const LISTS: { key: ListKey; normalize(value: string): string | null; empty: string }[] = [
  { key: 'dictionary', normalize: (v) => v.trim() || null, empty: 'No words yet.' },
  { key: 'ignoredSites', normalize: normalizeSite, empty: 'No ignored sites.' },
];

const section = (key: ListKey) => document.querySelector<HTMLElement>(`[data-list="${key}"]`)!;

async function setList(key: ListKey, values: string[]) {
  await updateSettings({ [key]: values } as Partial<Settings>);
}

function render(settings: Settings) {
  for (const { key, empty } of LISTS) {
    const ul = section(key).querySelector('ul')!;
    const values = settings[key];
    if (values.length === 0) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = empty;
      ul.replaceChildren(li);
      continue;
    }
    ul.replaceChildren(...values.map((value) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = value;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        const current = await getSettings();
        await setList(key, current[key].filter((v) => v !== value));
      });
      li.append(label, remove);
      return li;
    }));
  }
}

for (const { key, normalize } of LISTS) {
  const form = section(key).querySelector('form')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.elements.namedItem('value') as HTMLInputElement;
    const value = normalize(input.value);
    if (!value) return;
    const current = await getSettings();
    if (!current[key].includes(value)) await setList(key, [...current[key], value]);
    input.value = '';
  });
}

void getSettings().then(render);
watchSettings(render);
```

- [ ] **Step 6: Run all tests**

Run: `npm test && npm run compile && npm run e2e`
Expected: all unit tests PASS, no type errors, 5 e2e tests PASS.

- [ ] **Step 7: Write the README**

`README.md`:
````markdown
# OpenGrammar

Private, local grammar checking in your browser. Underlines spelling and grammar issues as you type in
text boxes and rich editors, with fixes, ignore, a personal dictionary and per-site disable.
Grammar checking runs on [Harper](https://writewithharper.com) inside the extension — no text leaves your machine.

## Develop

```bash
npm install
npm run dev            # Chromium with the extension loaded, hot reload
npm run dev:firefox    # Firefox
npm test               # unit tests
npm run e2e            # build + Playwright tests (run `npx playwright install chromium` once)
```

Builds: `npm run build` → `.output/chrome-mv3`, `npm run build:firefox` → `.output/firefox-mv3`.

## Roadmap

Plan 2: in-browser model for better wording and non-English grammar, LanguageTool (Full mode), editor page.
````

- [ ] **Step 8: Firefox manual smoke test**

Run: `npm run dev:firefox`
In the Firefox window that opens:
1. Go to `about:addons` → OpenGrammar → Permissions → allow access to all websites (Firefox MV3 makes host access opt-in).
2. Open any page with a textarea (e.g. `https://developer.mozilla.org/en-US/docs/Web/HTML/Element/textarea` live example), type `This is teh test.`
3. Expected: red underline under `teh`; clicking it shows the card; applying `the` fixes the text.
4. Open the popup, untick "Check on <site>" → underline disappears.
Record the result (pass, or the exact console error from `about:debugging` → Inspect) in the commit message body.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: popup, options page for dictionary and ignored sites, README"
```
