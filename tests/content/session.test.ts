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
    const actions = d.card.show.mock.calls[0]![3];
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
    d.card.show.mock.calls[0]![3].onAddToDictionary();
    expect(d.addToDictionary).toHaveBeenCalledWith('teh');
    expect(lastMarks(d)).toHaveLength(0);
  });

  it('destroy clears everything and stops rendering', async () => {
    const d = deps(async (_id, text) => [issueAt(text, 'teh')]);
    const onDispose = vi.fn();
    const adapter = fakeAdapter('This is teh test');
    const session = new FieldSession(adapter, { ...d, onDispose });
    await vi.runAllTimersAsync();
    const draws = d.overlay.draw.mock.calls.length;
    session.destroy();
    expect(d.overlay.clear).toHaveBeenCalledWith(session.id);
    expect(d.card.hide).toHaveBeenCalled();
    expect(onDispose).toHaveBeenCalledTimes(1);
    adapter.type('This is teh tests');
    window.dispatchEvent(new Event('resize'));
    await vi.runAllTimersAsync();
    expect(d.overlay.draw.mock.calls.length).toBe(draws);
  });

  it('hides the card when a click misses every mark', async () => {
    const d = deps(async (_id, text) => [issueAt(text, 'teh')]);
    const adapter = fakeAdapter('This is teh test');
    new FieldSession(adapter, d);
    await vi.runAllTimersAsync();
    d.card.hide.mockClear();
    adapter.el.dispatchEvent(new MouseEvent('click', { clientX: 400, clientY: 400 }));
    expect(d.card.hide).toHaveBeenCalledTimes(1);
    expect(d.card.show).not.toHaveBeenCalled();
  });

  it('coalesces scrolls into one draw per frame and hides the card', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const d = deps(async (_id, text) => [issueAt(text, 'teh')]);
    const adapter = fakeAdapter('This is teh test');
    new FieldSession(adapter, d);
    await vi.runAllTimersAsync();
    const draws = d.overlay.draw.mock.calls.length;
    d.card.hide.mockClear();
    adapter.el.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    expect(d.overlay.draw.mock.calls.length).toBe(draws);
    expect(d.card.hide).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(d.overlay.draw.mock.calls.length).toBe(draws + 1);
  });
});
