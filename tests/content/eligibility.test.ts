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
