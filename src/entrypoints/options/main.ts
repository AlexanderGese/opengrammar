import '@/assets/page.css';
import { getSettings, normalizeSite, updateSettings, watchSettings, type Settings } from '@/lib/settings';

type ListKey = 'dictionary' | 'ignoredSites';

const LISTS: { key: ListKey; normalize(value: string): string | null; empty: string }[] = [
  { key: 'dictionary', normalize: (v) => v.trim() || null, empty: 'No words yet.' },
  { key: 'ignoredSites', normalize: normalizeSite, empty: 'No ignored sites.' },
];

const section = (key: ListKey) => document.querySelector<HTMLElement>(`[data-list="${key}"]`)!;

async function setList(key: ListKey, values: string[]) {
  await updateSettings({ [key]: values } as Partial<Settings>);
}

function render(settings: Settings) {
  for (const { key, empty } of LISTS) {
    const ul = section(key).querySelector('ul')!;
    const values = settings[key];
    if (values.length === 0) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = empty;
      ul.replaceChildren(li);
      continue;
    }
    ul.replaceChildren(...values.map((value) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = value;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        const current = await getSettings();
        await setList(key, current[key].filter((v) => v !== value));
      });
      li.append(label, remove);
      return li;
    }));
  }
}

for (const { key, normalize } of LISTS) {
  const form = section(key).querySelector('form')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.elements.namedItem('value') as HTMLInputElement;
    const value = normalize(input.value);
    if (!value) return;
    const current = await getSettings();
    if (!current[key].includes(value)) await setList(key, [...current[key], value]);
    input.value = '';
  });
}

void getSettings().then(render);
watchSettings(render);
