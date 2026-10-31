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
