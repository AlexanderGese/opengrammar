export interface TextRange {
  start: number;
  end: number;
}

/** The only layer that knows about the DOM. Offsets are UTF-16 indices into getText(). */
export interface TextAdapter {
  readonly el: HTMLElement;
  getText(): string;
  /** Viewport-coordinate rects for each range, in input order. Empty array when not visible. */
  measure(ranges: TextRange[]): DOMRect[][];
  /** Replaces the range, keeping the editor's undo history where the browser allows it. */
  replace(range: TextRange, text: string): void;
  destroy(): void;
}

export function insertText(text: string): boolean {
  try {
    return typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
  } catch {
    return false;
  }
}
