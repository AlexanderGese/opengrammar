import { describe, expect, it } from 'vitest';
import { binaryInlined } from 'harper.js/binaryInlined';
import { HarperEngine, toIssueKind } from '@/engines/harper';

const engine = new HarperEngine(() => binaryInlined);
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

  it('rejects with AbortError when already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(engine.check('This is teh test.', 'en', ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' });
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
