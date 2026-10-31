/** Normalises text for matching: lowercase, strip accents and punctuation. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Scores how well `text` matches `query` (higher is better, 0 = no match).
 * Every query token must appear; prefix and whole-word hits score higher.
 */
export function matchScore(query: string, text: string): number {
  const q = normalize(query);
  if (!q) return 0;
  const t = normalize(text);
  if (!t) return 0;
  if (t === q) return 1000;
  let score = 0;
  if (t.startsWith(q)) score += 400;
  else if (t.includes(q)) score += 250;
  const words = t.split(' ');
  for (const token of q.split(' ')) {
    if (!t.includes(token)) {
      // allow a single typo for longer tokens
      if (token.length >= 5 && words.some((w) => w.length >= token.length - 1 && editDistanceAtMost1(w.slice(0, token.length + 1), token))) {
        score += 20;
        continue;
      }
      return 0;
    }
    if (words.includes(token)) score += 60;
    else if (words.some((w) => w.startsWith(token))) score += 40;
    else score += 10;
  }
  return score - Math.min(50, t.length - q.length) * 0.5;
}

/** True when a and b differ by at most one insertion, deletion, substitution or adjacent swap. */
function editDistanceAtMost1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    if (i < a.length - 1 && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)) return true;
  }
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function searchList<T>(items: T[], query: string, text: (item: T) => string, limit = 200): T[] {
  if (!normalize(query)) return [];
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const score = matchScore(query, text(item));
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.item);
}

/** Simple substring filter used by in-list filter boxes. */
export function quickFilter<T>(items: T[], query: string, text: (item: T) => string): T[] {
  const q = normalize(query);
  if (!q) return items;
  const tokens = q.split(' ');
  return items.filter((item) => {
    const t = normalize(text(item));
    return tokens.every((tok) => t.includes(tok));
  });
}
