const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url']);
const CODE_EDITORS = '.cm-editor, .CodeMirror, .monaco-editor, .ace_editor';
const OPTED_OUT = '[data-gramm="false"], [data-opengrammar="false"]';

export type Editable = HTMLTextAreaElement | HTMLInputElement | HTMLElement;

export function findEditable(target: EventTarget | null): Editable | null {
  if (!(target instanceof HTMLElement)) return null;

  if (target instanceof HTMLTextAreaElement) {
    return !target.readOnly && !target.disabled && allowed(target) ? target : null;
  }
  if (target instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(target.type) && !target.readOnly && !target.disabled && allowed(target)
      ? target
      : null;
  }
  if (target.isContentEditable) {
    let root: HTMLElement = target;
    while (root.parentElement?.isContentEditable) root = root.parentElement;
    return allowed(root) ? root : null;
  }
  return null;
}

function allowed(el: HTMLElement): boolean {
  return !el.closest(CODE_EDITORS) && !el.closest(OPTED_OUT);
}
