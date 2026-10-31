import { insertText, type TextAdapter, type TextRange } from './types';

const MIRRORED = [
  'box-sizing', 'width', 'height',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'font-family', 'font-size', 'font-style', 'font-variant', 'font-weight', 'font-stretch',
  'letter-spacing', 'line-height', 'text-transform', 'text-indent', 'text-align', 'word-spacing',
  'tab-size', 'direction', 'overflow-wrap', 'word-break',
];

/** Measures text positions by laying the same text out in a hidden div that copies the field's styles. */
export class TextareaAdapter implements TextAdapter {
  private mirror: HTMLDivElement | null = null;

  constructor(readonly el: HTMLTextAreaElement | HTMLInputElement) {}

  getText(): string {
    return this.el.value;
  }

  measure(ranges: TextRange[]): DOMRect[][] {
    if (ranges.length === 0) return [];
    const mirror = this.ensureMirror();
    const text = this.el.value;
    const spans: HTMLSpanElement[] = [];
    const order = ranges.map((r, i) => ({ ...r, i })).sort((a, b) => a.start - b.start);

    mirror.textContent = '';
    let pos = 0;
    for (const r of order) {
      const start = Math.max(r.start, pos);
      const end = Math.max(r.end, start);
      mirror.append(text.slice(pos, start));
      const span = document.createElement('span');
      span.textContent = text.slice(start, end);
      mirror.append(span);
      spans[r.i] = span;
      pos = end;
    }
    mirror.append(`${text.slice(pos)}​`);
    this.syncGeometry(mirror);
    return spans.map((span) => Array.from(span.getClientRects()));
  }

  replace({ start, end }: TextRange, text: string): void {
    const el = this.el;
    el.focus();
    el.setSelectionRange(start, end);
    if (!insertText(text)) {
      el.setRangeText(text, start, end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  destroy(): void {
    this.mirror?.remove();
    this.mirror = null;
  }

  private ensureMirror(): HTMLDivElement {
    if (!this.mirror) {
      this.mirror = document.createElement('div');
      this.mirror.dataset.ogMirror = '';
      this.mirror.setAttribute('aria-hidden', 'true');
      (document.body ?? document.documentElement).append(this.mirror);
    }
    return this.mirror;
  }

  private syncGeometry(mirror: HTMLDivElement): void {
    const el = this.el;
    const cs = getComputedStyle(el);
    for (const prop of MIRRORED) mirror.style.setProperty(prop, cs.getPropertyValue(prop));

    const box = el.getBoundingClientRect();
    const isTextarea = el instanceof HTMLTextAreaElement;
    mirror.style.setProperty('position', 'fixed');
    mirror.style.setProperty('left', `${box.left}px`);
    mirror.style.setProperty('top', `${box.top}px`);
    mirror.style.setProperty('margin', '0');
    mirror.style.setProperty('visibility', 'hidden');
    mirror.style.setProperty('pointer-events', 'none');
    mirror.style.setProperty('border-color', 'transparent');
    mirror.style.setProperty('white-space', isTextarea ? 'pre-wrap' : 'pre');
    mirror.style.setProperty('overflow-x', 'hidden');
    // Match the field's scrollbar so wrapping width is identical.
    mirror.style.setProperty('overflow-y', isTextarea && el.scrollHeight > el.clientHeight ? 'scroll' : 'hidden');
    if (!isTextarea) {
      // Inputs centre a single line vertically.
      const inner = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      mirror.style.setProperty('line-height', `${inner}px`);
    }
    mirror.scrollTop = el.scrollTop;
    mirror.scrollLeft = el.scrollLeft;
  }
}
