import { LocalLinter, SuggestionKind, type Lint, type LinterInit } from 'harper.js';
import type { GrammarEngine, Issue, IssueKind, Lang } from '@/lib/types';

const KINDS: Record<string, IssueKind> = {
  Spelling: 'spelling',
  Typo: 'spelling',
  Style: 'style',
  Readability: 'style',
  Enhancement: 'style',
  WordChoice: 'style',
  Redundancy: 'style',
  Repetition: 'style',
  Formatting: 'style',
};

export function toIssueKind(lintKind: string): IssueKind {
  return KINDS[lintKind] ?? 'grammar';
}

export class HarperEngine implements GrammarEngine {
  readonly id = 'harper' as const;
  private readonly linter: LocalLinter;
  private ready: Promise<void> | null = null;

  constructor(binary: LinterInit['binary']) {
    this.linter = new LocalLinter({ binary });
  }

  supports(lang: Lang): boolean {
    return lang === 'en';
  }

  async check(text: string, _lang: Lang, signal: AbortSignal): Promise<Issue[]> {
    if (signal.aborted) return [];
    this.ready ??= this.linter.setup().catch((e: unknown) => {
      this.ready = null; // let the next check retry
      throw e;
    });
    await this.ready;
    if (signal.aborted) return [];
    const lints = await this.linter.lint(text, { language: 'plaintext' });
    return lints.map((lint, n) => toIssue(lint, text, n));
  }
}

function toIssue(lint: Lint, text: string, n: number): Issue {
  const { start, end } = lint.span();
  const original = text.slice(start, end);
  const replacements = lint.suggestions().map((s) => {
    switch (s.kind()) {
      case SuggestionKind.Remove:
        return '';
      case SuggestionKind.InsertAfter:
        return original + s.get_replacement_text();
      default:
        return s.get_replacement_text();
    }
  });
  return {
    id: `harper-${start}-${end}-${n}`,
    start,
    end,
    kind: toIssueKind(lint.lint_kind()),
    source: 'harper',
    message: lint.message(),
    replacements,
    confidence: 'high',
  };
}
