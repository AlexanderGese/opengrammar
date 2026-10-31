export type Lang = string;
export type IssueKind = 'spelling' | 'grammar' | 'style' | 'wording';
export type IssueSource = 'harper' | 'languagetool' | 'model';

export interface Issue {
  id: string;
  start: number;
  end: number;
  kind: IssueKind;
  source: IssueSource;
  message: string;
  replacements: string[];
  confidence: 'high' | 'low';
}

export interface GrammarEngine {
  readonly id: IssueSource;
  supports(lang: Lang): boolean;
  check(text: string, lang: Lang, signal: AbortSignal): Promise<Issue[]>;
}

export interface CheckRequest {
  type: 'og:check';
  fieldId: string;
  text: string;
}

export interface CheckResponse {
  issues: Issue[];
}

export function isCheckRequest(message: unknown): message is CheckRequest {
  if (typeof message !== 'object' || message === null) return false;
  const m = message as Partial<CheckRequest>;
  return m.type === 'og:check' && typeof m.fieldId === 'string' && typeof m.text === 'string';
}
