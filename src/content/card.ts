import type { Issue } from '@/lib/types';

export interface CardActions {
  onApply(replacement: string): void;
  onIgnore(): void;
  onAddToDictionary?: () => void;
}

export const CARD_CSS = `
.og-card {
  position: fixed; width: 280px; box-sizing: border-box; padding: 12px;
  background: #fff; color: #1c2024; border: 1px solid #dfe3e6; border-radius: 10px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.14); pointer-events: auto;
  font: 14px/1.4 system-ui, sans-serif;
}
.og-msg { margin: 0 0 10px; }
.og-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.og-card button {
  font: inherit; cursor: pointer; border-radius: 6px; padding: 4px 10px;
  border: 1px solid #dfe3e6; background: transparent; color: inherit;
}
.og-card button.og-fix { background: #3e63dd; border-color: #3e63dd; color: #fff; font-weight: 600; }
@media (prefers-color-scheme: dark) {
  .og-card { background: #1c2024; color: #edeef0; border-color: #363a3f; }
  .og-card button { border-color: #363a3f; }
}
`;

export class SuggestionCard {
  private el: HTMLDivElement | null = null;

  constructor(private readonly root: ShadowRoot) {}

  show(issue: Issue, original: string, anchor: DOMRect, actions: CardActions): void {
    this.hide();
    const card = document.createElement('div');
    card.className = 'og-card';
    card.dataset.ogCard = '';
    // Keep focus (and the caret) in the field while clicking the card.
    card.addEventListener('mousedown', (e) => e.preventDefault());

    const message = document.createElement('p');
    message.className = 'og-msg';
    message.textContent = issue.message;

    const row = document.createElement('div');
    row.className = 'og-actions';
    for (const replacement of issue.replacements.slice(0, 3)) {
      const label = replacement === '' ? `Remove “${original}”` : replacement;
      row.append(this.button(label, 'og-fix', () => actions.onApply(replacement)));
    }
    row.append(this.button('Ignore', 'og-ignore', actions.onIgnore));
    if (actions.onAddToDictionary) {
      row.append(this.button('Add to dictionary', 'og-dict', actions.onAddToDictionary));
    }

    card.append(message, row);
    card.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - 288))}px`;
    card.style.top = `${anchor.bottom + 6}px`;
    this.root.append(card);
    this.el = card;
    if (anchor.bottom + 6 + card.offsetHeight > window.innerHeight) {
      card.style.top = `${Math.max(8, anchor.top - 6 - card.offsetHeight)}px`;
    }
  }

  hide(): void {
    this.el?.remove();
    this.el = null;
  }

  containsEvent(event: Event): boolean {
    return this.el !== null && event.composedPath().includes(this.el);
  }

  private button(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = label;
    b.addEventListener('click', () => {
      this.hide();
      onClick();
    });
    return b;
  }
}
