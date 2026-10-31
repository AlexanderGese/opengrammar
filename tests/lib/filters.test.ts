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
