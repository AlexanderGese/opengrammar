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

  it('layers the stored mode preset under overrides', async () => {
    await updateSettings({ mode: 'full' });
    expect(await getSettings()).toMatchObject({ mode: 'full', modelSize: 'small', proactiveWording: true });
    await updateSettings({ modelSize: 'tiny' });
    expect((await getSettings()).modelSize).toBe('tiny');
  });

  it('stores only the overrides', async () => {
    expect(await updateSettings({ enabled: false })).toEqual({ ...DEFAULT_SETTINGS, enabled: false });
    await updateSettings({ dictionary: ['a'] });
    const raw = await fakeBrowser.storage.local.get('settings');
    expect(raw.settings).toEqual({ enabled: false, dictionary: ['a'] });
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
