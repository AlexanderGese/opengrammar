import { storage } from 'wxt/utils/storage';
import type { Lang } from './types';

export type Mode = 'light' | 'full';

export interface Settings {
  enabled: boolean;
  mode: Mode;
  grammarEngineForOther: 'model' | 'languagetool';
  modelSize: 'tiny' | 'small';
  proactiveWording: boolean;
  languageToolUrl: string;
  defaultLanguage: Lang;
  dictionary: string[];
  ignoredSites: string[];
}

type ModePreset = Pick<Settings, 'grammarEngineForOther' | 'modelSize' | 'proactiveWording'>;

export const MODE_PRESETS: Record<Mode, ModePreset> = {
  light: { grammarEngineForOther: 'model', modelSize: 'tiny', proactiveWording: false },
  full: { grammarEngineForOther: 'languagetool', modelSize: 'small', proactiveWording: true },
};

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  mode: 'light',
  ...MODE_PRESETS.light,
  languageToolUrl: 'http://localhost:8081',
  defaultLanguage: 'en',
  dictionary: [],
  ignoredSites: [],
};

const settingsItem = storage.defineItem<Partial<Settings>>('local:settings', { fallback: {}, version: 1 });

export function withMode(settings: Settings, mode: Mode): Settings {
  return { ...settings, mode, ...MODE_PRESETS[mode] };
}

export async function getSettings(): Promise<Settings> {
  return resolve(await settingsItem.getValue());
}

/** Defaults, then the stored mode's preset, then the user's own overrides. */
function resolve(stored: Partial<Settings>): Settings {
  return { ...DEFAULT_SETTINGS, ...MODE_PRESETS[stored.mode ?? DEFAULT_SETTINGS.mode], ...stored };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  // Store only overrides so changed defaults reach users who never touched a field.
  const next = { ...(await settingsItem.getValue()), ...patch };
  await settingsItem.setValue(next);
  return resolve(next);
}

export function watchSettings(callback: (settings: Settings) => void): () => void {
  return settingsItem.watch((value) => callback(resolve(value)));
}

export async function addToDictionary(word: string): Promise<void> {
  const { dictionary } = await getSettings();
  if (dictionary.some((w) => w.toLowerCase() === word.toLowerCase())) return;
  await updateSettings({ dictionary: [...dictionary, word] });
}

export function isSiteIgnored(hostname: string, ignoredSites: string[]): boolean {
  const host = hostname.toLowerCase();
  return ignoredSites.some((entry) => {
    const site = entry.trim().toLowerCase();
    return site !== '' && (host === site || host.endsWith(`.${site}`));
  });
}

export function normalizeSite(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (raw === '') return null;
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname || null;
  } catch {
    return null;
  }
}
