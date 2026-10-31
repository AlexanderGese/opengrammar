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
