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
    expect(lines[0]!.dataset.issueId).toBe('a');
    expect(lines[1]!.classList.contains('og-low')).toBe(true);
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
    fixes[0]!.click();
    expect(onApply).toHaveBeenCalledWith('the');
    expect(overlay.root.querySelector('[data-og-card]')).toBeNull();
  });

  it('omits the dictionary action when not offered', () => {
    const overlay = new Overlay();
    new SuggestionCard(overlay.root).show(issue(), 'teh', new DOMRect(), { onApply: vi.fn(), onIgnore: vi.fn() });
    expect(overlay.root.querySelector('.og-dict')).toBeNull();
  });
});
