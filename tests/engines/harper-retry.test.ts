// Own file: harper's wasm glue keeps a module-level instance once any binary has loaded in this process.
import { describe, expect, it, vi } from 'vitest';
import { createBinaryModuleFromUrl } from 'harper.js';
import { binaryInlined } from 'harper.js/binaryInlined';
import { HarperEngine } from '@/engines/harper';

const signal = new AbortController().signal;

describe('HarperEngine setup', () => {
  it('builds a fresh linter from a fresh binary after a failed setup', async () => {
    const factory = vi.fn()
      .mockReturnValueOnce(createBinaryModuleFromUrl('file:///nonexistent/harper.wasm'))
      .mockReturnValue(binaryInlined);
    const e = new HarperEngine(factory);
    await expect(e.check('This is teh test.', 'en', signal)).rejects.toThrow();
    const text = 'This is teh test.';
    const issues = await e.check(text, 'en', signal);
    expect(issues.map((i) => text.slice(i.start, i.end))).toContain('teh');
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
