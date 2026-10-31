import { ignoreKey } from '@/lib/filters';
import { rebaseIssues } from '@/lib/rebase';
import type { Issue } from '@/lib/types';
import type { TextAdapter } from './adapters/types';
import type { SuggestionCard } from './card';
import type { Mark, Overlay } from './overlay';

export interface SessionDeps {
  overlay: Pick<Overlay, 'draw' | 'clear'>;
  card: Pick<SuggestionCard, 'show' | 'hide'>;
  check(fieldId: string, text: string): Promise<Issue[]>;
  addToDictionary(word: string): Promise<void>;
  onDispose?: () => void;
  debounceMs?: number;
}

let nextId = 0;

/** Owns one editable field: keeps issues in sync with its text and draws them. */
export class FieldSession {
  readonly id = `og-field-${++nextId}`;
  private text: string;
  private issues: Issue[] = [];
  private marks: Mark[] = [];
  private readonly ignored = new Set<string>();
  private version = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposers: (() => void)[] = [];
  private disposed = false;
  private frame: number | undefined;

  constructor(private readonly adapter: TextAdapter, private readonly deps: SessionDeps) {
    const el = adapter.el;
    this.text = adapter.getText();
    this.listen(el, 'input', () => this.onInput());
    this.listen(el, 'scroll', () => this.onScroll());
    this.listen(el, 'click', (e) => this.onClick(e as MouseEvent));
    this.listen(window, 'scroll', () => this.onScroll(), true);
    this.listen(window, 'resize', () => this.scheduleRender());
    const observer = new ResizeObserver(() => this.scheduleRender());
    observer.observe(el);
    this.disposers.push(() => observer.disconnect());
    this.schedule(0);
  }

  recheck(): void {
    this.schedule(0);
  }

  render(): void {
    if (this.disposed) return;
    if (!this.adapter.el.isConnected) {
      this.destroy();
      return;
    }
    const visible = this.issues.filter((i) => !this.ignored.has(ignoreKey(this.text, i)));
    const rects = this.adapter.measure(visible);
    this.marks = visible.map((issue, k) => ({ issue, rects: rects[k] ?? [] }));
    this.deps.overlay.draw(this.id, this.marks, this.adapter.el.getBoundingClientRect());
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    for (const dispose of this.disposers) dispose();
    this.deps.overlay.clear(this.id);
    this.deps.card.hide();
    this.adapter.destroy();
    this.deps.onDispose?.();
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void, capture = false): void {
    target.addEventListener(type, fn, capture);
    this.disposers.push(() => target.removeEventListener(type, fn, capture));
  }

  private onScroll(): void {
    this.deps.card.hide();
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.disposed || this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.render();
    });
  }

  private onInput(): void {
    const next = this.adapter.getText();
    this.issues = rebaseIssues(this.issues, this.text, next);
    this.text = next;
    this.deps.card.hide();
    this.render();
    this.schedule(this.deps.debounceMs ?? 300);
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), ms);
  }

  private async run(): Promise<void> {
    const version = ++this.version;
    const text = this.adapter.getText();
    let issues: Issue[];
    try {
      issues = await this.deps.check(this.id, text);
    } catch {
      return;
    }
    if (this.disposed || version !== this.version || text !== this.adapter.getText()) return;
    this.text = text;
    this.issues = issues;
    this.render();
  }

  private onClick(e: MouseEvent): void {
    const hit = this.marks.find((m) =>
      m.rects.some((r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom + 3),
    );
    if (!hit) {
      this.deps.card.hide();
      return;
    }
    const { issue } = hit;
    const anchor = hit.rects[0];
    if (!anchor) return;
    const original = this.text.slice(issue.start, issue.end);
    const hide = () => {
      this.ignored.add(ignoreKey(this.text, issue));
      this.render();
    };
    this.deps.card.show(issue, original, anchor, {
      onApply: (replacement) => this.adapter.replace(issue, replacement),
      onIgnore: hide,
      onAddToDictionary: issue.kind === 'spelling'
        ? () => {
            this.deps.addToDictionary(original).catch(() => {});
            hide();
          }
        : undefined,
    });
  }
}
