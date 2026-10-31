import type { Issue } from './types';

/**
 * Moves issues to match `newText` after a single contiguous edit, so underlines stay put while
 * the next check is pending. Issues that touch the edited region are dropped.
 */
export function rebaseIssues(issues: Issue[], oldText: string, newText: string): Issue[] {
  if (oldText === newText) return issues;

  const max = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < max && oldText[prefix] === newText[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) suffix++;

  const editEnd = oldText.length - suffix;
  const delta = newText.length - oldText.length;

  return issues.flatMap((issue) => {
    if (issue.end < prefix) return [issue];
    if (issue.start > editEnd) return [{ ...issue, start: issue.start + delta, end: issue.end + delta }];
    return [];
  });
}
