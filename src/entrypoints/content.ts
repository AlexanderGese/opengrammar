import { ContentEditableAdapter } from '@/content/adapters/contenteditable';
import { TextareaAdapter } from '@/content/adapters/textarea';
import type { TextAdapter } from '@/content/adapters/types';
import { SuggestionCard } from '@/content/card';
import { findEditable, type Editable } from '@/content/eligibility';
import { Overlay } from '@/content/overlay';
import { FieldSession } from '@/content/session';
import { addToDictionary, getSettings, isSiteIgnored, watchSettings } from '@/lib/settings';
import type { CheckRequest, CheckResponse, Issue } from '@/lib/types';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  async main(ctx) {
    let settings = await getSettings();
    const overlay = new Overlay();
    const card = new SuggestionCard(overlay.root);
    const sessions = new Map<Editable, FieldSession>();
    const active = () => settings.enabled && !isSiteIgnored(location.hostname, settings.ignoredSites);

    const check = async (fieldId: string, text: string): Promise<Issue[]> => {
      const request: CheckRequest = { type: 'og:check', fieldId, text };
      const response = (await browser.runtime.sendMessage(request)) as CheckResponse | undefined;
      return response?.issues ?? [];
    };

    const attach = (target: EventTarget | null) => {
      if (!active()) return;
      const el = findEditable(target);
      if (!el || sessions.has(el)) return;
      const adapter: TextAdapter =
        el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
          ? new TextareaAdapter(el)
          : new ContentEditableAdapter(el);
      sessions.set(el, new FieldSession(adapter, {
        overlay, card, check, addToDictionary,
        onDispose: () => sessions.delete(el),
      }));
    };

    const destroyAll = () => {
      for (const session of [...sessions.values()]) session.destroy();
      card.hide();
    };

    document.addEventListener('focusin', (e) => attach(e.target), true);
    document.addEventListener('mousedown', (e) => { if (!card.containsEvent(e)) card.hide(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') card.hide(); }, true);

    const unwatch = watchSettings((next) => {
      settings = next;
      if (!active()) destroyAll();
      else for (const session of sessions.values()) session.recheck();
    });

    attach(document.activeElement);
    ctx.onInvalidated(() => {
      unwatch();
      destroyAll();
    });
  },
});
