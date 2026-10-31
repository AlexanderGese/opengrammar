import '@/assets/page.css';
import { getSettings, isSiteIgnored, updateSettings } from '@/lib/settings';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname : null;
  } catch {
    return null;
  }
}

async function init() {
  const settings = await getSettings();
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const host = hostOf(tab?.url);

  const enabled = byId<HTMLInputElement>('enabled');
  enabled.checked = settings.enabled;
  enabled.addEventListener('change', () => void updateSettings({ enabled: enabled.checked }));

  const siteRow = byId<HTMLLabelElement>('site-row');
  if (!host) {
    siteRow.hidden = true;
  } else {
    byId('site').textContent = host;
    const siteEnabled = byId<HTMLInputElement>('site-enabled');
    siteEnabled.checked = !isSiteIgnored(host, settings.ignoredSites);
    siteEnabled.addEventListener('change', async () => {
      const { ignoredSites } = await getSettings();
      await updateSettings({
        ignoredSites: siteEnabled.checked
          ? ignoredSites.filter((site) => !isSiteIgnored(host, [site]))
          : [...new Set([...ignoredSites, host])],
      });
    });
  }

  byId('open-options').addEventListener('click', (e) => {
    e.preventDefault();
    void browser.runtime.openOptionsPage();
  });
}

void init();
