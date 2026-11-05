import { parseChannelTags } from '../../shared/channels';
import type { Movie } from './types';

/**
 * Newest films by release year (not by when the provider added them), for the home page.
 * Within a year, the most recently added come first. Copies of one film ("EN - Dune (2024) 4K",
 * "LAT| Dune (2024)") count once. Years after this one are typos or placeholders and are skipped.
 * Starts with this year and last year, reaching further back only to fill the row.
 */
export function newReleases(movies: Movie[], opts: { limit?: number; now?: number } = {}): Movie[] {
  const limit = opts.limit ?? 20;
  const thisYear = new Date(opts.now ?? Date.now()).getFullYear();
  const dated = movies.filter((m) => m.year && m.year <= thisYear && m.year >= thisYear - 5);
  dated.sort((a, b) => b.year! - a.year! || (b.added ?? 0) - (a.added ?? 0) || (b.rating ?? 0) - (a.rating ?? 0));
  const seen = new Set<string>();
  const out: Movie[] = [];
  for (const m of dated) {
    if (out.length >= limit) break;
    if (m.year! < thisYear - 1 && out.length >= Math.min(limit, 10)) break; // only reach back to fill a thin row
    const key = `${parseChannelTags(m.name).base.replace(/\b(19|20)\d{2}\b/g, '').trim()}|${m.year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

const RELEASE_CATEGORY = /\bnew\s*releas(?:e|ed|es)\b|\bjust\s*released\b|\bestrenos?\b|\bnuevos?\s*lanzamientos?\b|\blan[cç]amentos?\b/i;

/**
 * The provider's own "new releases" movie category (e.g. "|EN| NEW RELEASED"), if it has one.
 * Several regional ones ("|EN| …", "|LAT| ESTRENOS") → English first, then the largest.
 */
export function releaseCategory<C extends { id: string; name: string }>(categories: C[], movieCount: (id: string) => number): C | undefined {
  const english = (c: C) => (/(^|[^a-z])(en|eng|english|uk|us)([^a-z]|$)/i.test(c.name) ? 1 : 0);
  return categories
    .filter((c) => RELEASE_CATEGORY.test(c.name) && movieCount(c.id) > 0)
    .sort((a, b) => english(b) - english(a) || movieCount(b.id) - movieCount(a.id))[0];
}
