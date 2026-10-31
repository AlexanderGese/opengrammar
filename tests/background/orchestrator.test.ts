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
