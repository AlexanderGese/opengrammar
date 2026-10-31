import { createBinaryModuleFromUrl } from 'harper.js';
import { Orchestrator } from '@/background/orchestrator';
import { HarperEngine } from '@/engines/harper';
import { detectLang } from '@/lib/language';
import { getSettings } from '@/lib/settings';
import { isCheckRequest, type CheckResponse } from '@/lib/types';

export default defineBackground(() => {
  const orchestrator = new Orchestrator({
    engines: [new HarperEngine(() => createBinaryModuleFromUrl(browser.runtime.getURL('/harper.wasm' as any), 'full'))],
    getSettings,
    detect: (text, fallback) =>
      detectLang(text, fallback, async (t) => {
        const result = await browser.i18n.detectLanguage(t);
        return {
          isReliable: result.isReliable,
          languages: result.languages.map((l) => ({ language: l.language, percentage: l.percentage })),
        };
      }),
  });

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse: (r: CheckResponse) => void) => {
    if (!isCheckRequest(message)) return false;
    const fieldKey = `${sender.tab?.id ?? 'ext'}:${sender.frameId ?? 0}:${message.fieldId}`;
    orchestrator.check(fieldKey, message.text).then(
      (issues) => sendResponse({ issues }),
      (error) => {
        console.error('[OpenGrammar] check failed', error);
        sendResponse({ issues: [] });
      },
    );
    return true; // keep the channel open for the async response (works in Chromium and Firefox)
  });
});
