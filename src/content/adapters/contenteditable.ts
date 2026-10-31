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
    const segs = this.segments;
    const endOf = (seg: Segment) => seg.start + seg.node.data.length;
    const at = (seg: Segment, o: number) => ({ node: seg.node, offset: o });
    if (segs.length === 0) return null;

    if (bias === 'start') {
      for (const seg of segs) if (offset >= seg.start && offset < endOf(seg)) return at(seg, offset - seg.start);
      for (const seg of segs) if (endOf(seg) === offset) return at(seg, offset - seg.start);
      const next = segs.find((seg) => seg.start > offset);
      if (next) return at(next, 0);
      const last = segs[segs.length - 1]!;
      return at(last, last.node.data.length);
    }
    for (const seg of segs) if (offset > seg.start && offset <= endOf(seg)) return at(seg, offset - seg.start);
    for (const seg of segs) if (seg.start === offset) return at(seg, 0);
    let prev: Segment | undefined;
    for (const seg of segs) if (seg.start < offset) prev = seg;
    const seg = prev ?? segs[0]!;
    return at(seg, prev ? seg.node.data.length : 0);
  }

  private toDomRange({ start, end }: TextRange): Range | null {
    if (this.segments.length === 0) {
      const empty = document.createRange();
      empty.setStart(this.el, 0);
      empty.setEnd(this.el, 0);
      return empty;
    }
    const a = this.pointAt(start, 'start');
    const b = this.pointAt(end, 'end');
    if (!a || !b) return null;
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    return range;
  }
}
