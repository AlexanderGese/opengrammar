export interface TextRange {
  start: number;
  end: number;
}

/** The only layer that knows about the DOM. Offsets are UTF-16 indices into getText(). */
export interface TextAdapter {
  readonly el: HTMLElement;
  getText(): string;
  /** Viewport-coordinate rects for each range, in input order. Rects may lie outside the field when its content is scrolled; callers clip to the field's box. */
  measure(ranges: TextRange[]): DOMRect[][];
  /** Replaces the range, keeping the editor's undo history where the browser allows it. */
  replace(range: TextRange, text: string): void;
  destroy(): void;
}

export function insertText(text: string): boolean {
  try {
    if (typeof document.execCommand !== 'function') return false;
    // Firefox ignores insertText with an empty string; deletion needs its own command.
    return text === '' ? document.execCommand('delete') : document.execCommand('insertText', false, text);
  } catch {
    return false;
  }
}
