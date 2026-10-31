import { describe, expect, it } from 'vitest';
import { LruCache } from '@/lib/cache';

describe('LruCache', () => {
  it('returns stored values', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    expect(c.get('a')).toBe(1);
    expect(c.get('missing')).toBeUndefined();
  });

  it('evicts the least recently used entry', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a'); // a is now most recent
    c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
    expect(c.size).toBe(2);
  });
});
