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
