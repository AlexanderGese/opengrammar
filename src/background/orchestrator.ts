import { LruCache } from '@/lib/cache';
import { filterDictionary } from '@/lib/filters';
import { splitSentences } from '@/lib/sentences';
import type { Settings } from '@/lib/settings';
import type { GrammarEngine, Issue, Lang } from '@/lib/types';

export interface OrchestratorDeps {
  engines: GrammarEngine[];
  getSettings(): Promise<Settings>;
  detect(text: string, fallback: Lang): Promise<Lang>;
  cacheSize?: number;
}

export class Orchestrator {
  private readonly cache: LruCache<Issue[]>;
  private readonly inflight = new Map<string, AbortController>();

  constructor(private readonly deps: OrchestratorDeps) {
    this.cache = new LruCache(deps.cacheSize ?? 500);
  }

  async check(fieldId: string, text: string): Promise<Issue[]> {
    this.inflight.get(fieldId)?.abort();
    const ctrl = new AbortController();
    this.inflight.set(fieldId, ctrl);
    try {
      const settings = await this.deps.getSettings();
      if (!settings.enabled) return [];
      const lang = await this.deps.detect(text, settings.defaultLanguage);
      const engine = this.deps.engines.find((e) => e.supports(lang));
      if (!engine) return [];

      const issues: Issue[] = [];
      for (const sentence of splitSentences(text)) {
        const key = `${engine.id}|${lang}|${sentence.text}`;
        let found = this.cache.get(key);
        if (!found) {
          found = await engine.check(sentence.text, lang, ctrl.signal);
          if (ctrl.signal.aborted) return [];
          this.cache.set(key, found);
        }
        for (const issue of found) {
          const start = issue.start + sentence.start;
          const end = issue.end + sentence.start;
          issues.push({ ...issue, id: `${issue.source}-${start}-${end}-${issues.length}`, start, end });
        }
      }
      if (ctrl.signal.aborted) return [];
      return filterDictionary(issues, text, settings.dictionary);
    } finally {
      if (this.inflight.get(fieldId) === ctrl) this.inflight.delete(fieldId);
    }
  }
}
