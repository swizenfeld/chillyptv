import { parseChannelTags, QUALITY_LABEL } from '../../shared/channels';
import { languageName } from '../../shared/media';
import type { Catalog, Movie, SeriesItem } from './types';

/** Words providers add to mark a dub or release that aren't part of the title. */
const RELEASE_WORDS = /\b(dual|subtitulad[oa]|subbed|sub|subs|vose|vos|vo|multi|audio|dub|dubbed|doblad[oa]|lat|latam|cast|extended|remastered|imax|uncut|4k|uhd|hdr|hdr10|dv|dolby vision)\b/g;

/** "EN - Dune: Part Two (2024) 4K" and "LAT| Dune Part Two [2024]" → "dune part two". */
export function titleKey(name: string): string {
  return parseChannelTags(name)
    .base.replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(RELEASE_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type Item = Movie | SeriesItem;
const indexes = new WeakMap<Catalog, { movie: Map<string, Movie[]>; series: Map<string, SeriesItem[]> }>();

function indexFor(c: Catalog) {
  let ix = indexes.get(c);
  if (!ix) {
    const build = <T extends Item>(items: T[]) => {
      const m = new Map<string, T[]>();
      for (const it of items) {
        const k = titleKey(it.name);
        if (k.length >= 2) (m.get(k) ?? m.set(k, []).get(k)!).push(it);
      }
      return m;
    };
    ix = { movie: build(c.movies), series: build(c.series) };
    indexes.set(c, ix);
  }
  return ix;
}

export interface OtherVersion<T extends Item> {
  item: T;
  /** "Spanish", "English"… from the title or its category, if either says. */
  language?: string;
  quality?: string;
  category: string;
}

/**
 * The same film or show elsewhere in the catalogue — usually another language category
 * ("|EN| NEW RELEASED" vs "|LAT| ESTRENOS"). Matched on the cleaned title and, when both know it, the year.
 */
export function otherVersions<T extends Item>(kind: 'movie' | 'series', item: T, catalog: Catalog, categoryName: (id: string) => string, visible: (categoryId: string) => boolean = () => true): OtherVersion<T>[] {
  const list = (indexFor(catalog)[kind] as Map<string, T[]>).get(titleKey(item.name)) ?? [];
  const describe = (it: T): OtherVersion<T> => {
    const cat = categoryName(it.categoryId);
    const tags = parseChannelTags(it.name, cat);
    return { item: it, language: languageName(tags.lang), quality: QUALITY_LABEL[tags.quality] || undefined, category: cat };
  };
  const self = describe(item);
  const rank = (v: OtherVersion<T>) => (!v.language ? 1 : v.language === self.language ? 2 : 0);
  return list
    .filter((it) => it.id !== item.id && visible(it.categoryId) && (!it.year || !item.year || it.year === item.year))
    .map(describe)
    // Other languages first (the point of the list), then unknown, then other copies in this language.
    .sort((a, b) => rank(a) - rank(b) || (a.language ?? '').localeCompare(b.language ?? '') || a.category.localeCompare(b.category))
    .slice(0, 12);
}
