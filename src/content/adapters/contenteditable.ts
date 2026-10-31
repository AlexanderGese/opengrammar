import { insertText, type TextAdapter, type TextRange } from './types';

const BLOCKS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE', 'FOOTER',
  'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL',
]);
const SKIPPED = new Set(['SCRIPT', 'STYLE', 'TEMPLATE']);

interface Segment {
  node: Text;
  start: number;
}

export class ContentEditableAdapter implements TextAdapter {
  private segments: Segment[] = [];
  private text = '';

  constructor(readonly el: HTMLElement) {}

  getText(): string {
    this.rebuild();
    return this.text;
  }

  measure(ranges: TextRange[]): DOMRect[][] {
    this.rebuild();
    return ranges.map((r) => {
      const range = this.toDomRange(r);
      return range ? Array.from(range.getClientRects()) : [];
    });
  }

  replace(r: TextRange, text: string): void {
    this.rebuild();
    const range = this.toDomRange(r);
    if (!range) return;
    this.el.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (!insertText(text)) {
      range.deleteContents();
      if (text !== '') range.insertNode(document.createTextNode(text));
      this.el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  destroy(): void {}

  private rebuild(): void {
    const segments: Segment[] = [];
    let text = '';
    const newline = () => {
      if (text !== '' && !text.endsWith('\n')) text += '\n';
    };
    const visit = (node: Node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const t = child as Text;
          if (t.data !== '') {
            segments.push({ node: t, start: text.length });
            text += t.data;
          }
        } else if (child instanceof HTMLBRElement) {
          text += '\n';
        } else if (child instanceof HTMLElement && !SKIPPED.has(child.tagName)) {
          const block = BLOCKS.has(child.tagName);
          if (block) newline();
          visit(child);
          if (block) newline();
        }
      }
    };
    visit(this.el);
    this.segments = segments;
    this.text = text;
  }

  private pointAt(offset: number, bias: 'start' | 'end'): { node: Text; offset: number } | null {
    for (const seg of this.segments) {
      const segEnd = seg.start + seg.node.data.length;
      const inside = bias === 'start'
        ? offset >= seg.start && offset < segEnd
        : offset > seg.start && offset <= segEnd;
      if (inside) return { node: seg.node, offset: offset - seg.start };
    }
    return null;
  }

  private toDomRange({ start, end }: TextRange): Range | null {
    const a = this.pointAt(start, 'start');
    const b = this.pointAt(end, 'end');
    if (!a || !b) return null;
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    return range;
  }
}
