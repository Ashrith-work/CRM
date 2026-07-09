/**
 * A small, dependency-free, DETERMINISTIC text embedder used to ground the
 * assistant against the glossary in pgvector.
 *
 * Why local: Anthropic has no embeddings endpoint, and the glossary is tiny
 * (~15 definitions), so a hashed bag-of-tokens embedding is enough to retrieve
 * the right definition for a question — and it needs no extra API key, works
 * offline, and is deterministic (so tests + cache keys are stable). It is
 * intentionally behind a single function so a real vendor (e.g. Voyage) can be
 * swapped in without touching the grounding/retrieval code or the pgvector
 * schema (just keep EMBEDDING_DIM in sync with the migration's vector(N)).
 */

export const EMBEDDING_DIM = 256;

const TOKEN_RE = /[a-z0-9]+/g;

/** FNV-1a 32-bit hash — fast, stable, no deps. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(TOKEN_RE) ?? []).filter((t) => t.length > 1);
}

/**
 * Embed text into a unit vector of length EMBEDDING_DIM. Unigrams + adjacent
 * bigrams are hashed into buckets with a signed contribution, then the vector
 * is L2-normalized so a dot product equals cosine similarity.
 */
export function embedText(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const tokens = tokenize(text);

  const add = (term: string, weight: number) => {
    const h = fnv1a(term);
    const bucket = h % EMBEDDING_DIM;
    const sign = (h & 0x100) === 0 ? 1 : -1; // stable sign bit → reduces collisions
    vec[bucket] += sign * weight;
  };

  for (let i = 0; i < tokens.length; i++) {
    add(tokens[i], 1);
    if (i + 1 < tokens.length) add(`${tokens[i]}_${tokens[i + 1]}`, 0.5);
  }

  // L2-normalize (guard the empty/zero case).
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

/** Cosine similarity for two unit vectors (dot product). Used in the fallback path. */
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

/** Format a vector as a pgvector literal: '[0.1,0.2,...]'. */
export function toPgVector(vec: number[]): string {
  return `[${vec.map((v) => v.toFixed(6)).join(',')}]`;
}
