import { describe, expect, it } from 'vitest';
import { rebaseIssues } from '@/lib/rebase';
import type { Issue } from '@/lib/types';

const at = (start: number, end: number): Issue => ({
  id: `i${start}`, start, end, kind: 'spelling', source: 'harper', message: 'm', replacements: [], confidence: 'high',
});

describe('rebaseIssues', () => {
  const old = 'This is teh test';

  it('shifts issues after an insertion before them', () => {
    expect(rebaseIssues([at(8, 11)], old, 'Yes! This is teh test')).toEqual([{ ...at(8, 11), start: 13, end: 16 }]);
  });

  it('keeps issues before an edit unchanged', () => {
    expect(rebaseIssues([at(8, 11)], old, 'This is teh test!')).toEqual([at(8, 11)]);
  });

  it('drops issues the edit touches', () => {
    expect(rebaseIssues([at(8, 11)], old, 'This is tehh test')).toEqual([]);
    expect(rebaseIssues([at(8, 11)], old, 'This is the test')).toEqual([]);
  });

  it('returns the same issues when text is unchanged', () => {
    const issues = [at(8, 11)];
    expect(rebaseIssues(issues, old, old)).toBe(issues);
  });
});
