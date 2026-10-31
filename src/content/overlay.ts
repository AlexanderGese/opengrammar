import type { Issue, IssueKind } from '@/lib/types';
import { CARD_CSS } from './card';

export interface Mark {
  issue: Issue;
  rects: DOMRect[];
}

const COLORS: Record<IssueKind, string> = {
  spelling: '#e5484d',
  grammar: '#3e63dd',
  style: '#3e63dd',
  wording: '#8e4ec6',
};

const CSS = `
.og-line { position: fixed; height: 0; border-bottom: 2px solid var(--og-color); pointer-events: none; }
.og-line.og-low { border-bottom-style: dotted; }
${CARD_CSS}`;

/** One fixed, click-through layer per page; underlines are drawn in viewport coordinates. */
export class Overlay {
  readonly root: ShadowRoot;
  private readonly layers = new Map<string, HTMLDivElement>();

  constructor() {
    const host = document.createElement('opengrammar-overlay');
    host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;';
    this.root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    this.root.append(style);
    document.documentElement.append(host);
  }

  /** Remove the host element and forget every field layer. */
  destroy(): void {
    this.layers.clear();
    this.root.host.remove();
  }

  draw(fieldId: string, marks: Mark[], clip: DOMRect): void {
    let layer = this.layers.get(fieldId);
    if (!layer) {
      layer = document.createElement('div');
      layer.dataset.ogField = fieldId;
      this.root.append(layer);
      this.layers.set(fieldId, layer);
    }
    const lines: HTMLDivElement[] = [];
    for (const { issue, rects } of marks) {
      for (const r of rects) {
        const left = Math.max(r.left, clip.left);
        const right = Math.min(r.right, clip.right);
        if (right <= left || r.bottom < clip.top || r.bottom > clip.bottom + 2) continue;
        const line = document.createElement('div');
        line.className = issue.confidence === 'low' ? 'og-line og-low' : 'og-line';
        line.dataset.ogUnderline = issue.kind;
        line.dataset.issueId = issue.id;
        line.style.cssText = `left:${left}px;top:${r.bottom - 2}px;width:${right - left}px;--og-color:${COLORS[issue.kind]}`;
        lines.push(line);
      }
    }
    layer.replaceChildren(...lines);
  }

  clear(fieldId: string): void {
    this.layers.get(fieldId)?.remove();
    this.layers.delete(fieldId);
  }
}
