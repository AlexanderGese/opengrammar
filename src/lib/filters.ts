import type { Issue } from './types';

export function filterDictionary(issues: Issue[], text: string, dictionary: string[]): Issue[] {
  if (dictionary.length === 0) return issues;
  const words = new Set(dictionary.map((w) => w.toLowerCase()));
  return issues.filter(
    (issue) => issue.kind !== 'spelling' || !words.has(text.slice(issue.start, issue.end).toLowerCase()),
  );
}

/** Identifies an issue independent of where it sits, so "Ignore" survives edits elsewhere. */
export function ignoreKey(text: string, issue: Issue): string {
  return `${text.slice(issue.start, issue.end)}\u0000${issue.message}`;
}
