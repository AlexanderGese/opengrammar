import type { Lang } from './types';

export type Detector = (text: string) => Promise<{
  isReliable: boolean;
  languages: { language: string; percentage: number }[];
}>;

const MIN_LENGTH = 20;

export async function detectLang(text: string, fallback: Lang, detector: Detector): Promise<Lang> {
  if (text.trim().length < MIN_LENGTH) return fallback;
  try {
    const result = await detector(text);
    const top = result.languages[0];
    if (!result.isReliable || !top) return fallback;
    const lang = top.language.split('-')[0]?.toLowerCase();
    return !lang || lang === 'und' ? fallback : lang;
  } catch {
    return fallback;
  }
}
