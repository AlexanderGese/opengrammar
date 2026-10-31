export interface Sentence {
  text: string;
  start: number;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });

export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  for (const { segment, index } of segmenter.segment(text)) {
    if (segment.trim() === '') continue;
    sentences.push({ text: segment, start: index });
  }
  return sentences;
}
