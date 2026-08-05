/**
 * Simple token-approximation chunker. Splits extracted document text into
 * ~512-token segments with 50-token overlap (spec §Step 2). We approximate
 * tokens as chars/4, which is close enough for chunking purposes without
 * pulling in a tokenizer.
 */

const APPROX_CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 512;
const OVERLAP_TOKENS = 50;

export interface TextChunk {
  index: number;
  text: string;
}

export function chunkText(text: string): TextChunk[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const targetChars = TARGET_TOKENS * APPROX_CHARS_PER_TOKEN;
  const overlapChars = OVERLAP_TOKENS * APPROX_CHARS_PER_TOKEN;

  const chunks: TextChunk[] = [];
  let cursor = 0;
  let index = 0;
  while (cursor < clean.length) {
    const end = Math.min(cursor + targetChars, clean.length);
    // Prefer splitting on paragraph → sentence → word boundary within the last
    // 20% of the window; falls back to hard-cut so we never loop.
    let cut = end;
    if (end < clean.length) {
      const searchStart = cursor + Math.floor(targetChars * 0.8);
      const scope = clean.slice(searchStart, end);
      const paragraph = scope.lastIndexOf("\n\n");
      const sentence = scope.search(/[.!?]\s[A-Z]/);
      const space = scope.lastIndexOf(" ");
      const relative = paragraph >= 0 ? paragraph : sentence >= 0 ? sentence : space;
      if (relative >= 0) cut = searchStart + relative + 1;
    }
    const slice = clean.slice(cursor, cut).trim();
    if (slice) {
      chunks.push({ index, text: slice });
      index += 1;
    }
    if (cut >= clean.length) break;
    cursor = Math.max(cut - overlapChars, cursor + 1);
  }
  return chunks;
}
