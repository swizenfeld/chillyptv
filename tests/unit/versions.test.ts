import { describe, expect, it } from 'vitest';
import { otherVersions, titleKey } from '../../src/lib/versions';
import type { Catalog, Movie } from '../../src/lib/types';

const cats: Record<string, string> = { en: '|EN| NEW RELEASED', lat: '|LAT| ESTRENOS', k4: '4K MOVIES', kids: 'Kids' };
const mv = (id: string, name: string, categoryId: string, year?: number): Movie => ({ id, name, categoryId, year });

describe('other versions of a title', () => {
  it('cleans language, quality and release words from titles', () => {
    expect(titleKey('EN - Dune: Part Two (2024) 4K')).toBe('dune part two');
    expect(titleKey('LAT| Dune Part Two [2024] (Dual)')).toBe('dune part two');
    expect(titleKey('Dune Part Two (2024) [Subtitulado]')).toBe('dune part two');
  });
  it('finds the same film in other categories, with language and quality', () => {
    const movies = [mv('1', 'Dune: Part Two (2024)', 'en', 2024), mv('2', 'Dune Part Two (2024)', 'lat', 2024), mv('3', 'Dune Part Two 4K', 'k4', 2024), mv('4', 'Dune (1984)', 'en', 1984), mv('5', 'Dune Part Two', 'kids', 2019)];
    const catalog = { movies, series: [] } as unknown as Catalog;
    const v = otherVersions('movie', movies[0], catalog, (id) => cats[id]);
    expect(v.map((x) => [x.item.id, x.language, x.quality])).toEqual([
      ['2', 'Spanish', undefined],
      ['3', undefined, '4K'],
    ]);
  });
  it('respects locked categories', () => {
    const movies = [mv('1', 'Dune Part Two', 'en'), mv('2', 'Dune Part Two', 'lat')];
    const catalog = { movies, series: [] } as unknown as Catalog;
    expect(otherVersions('movie', movies[0], catalog, (id) => cats[id], (id) => id !== 'lat')).toEqual([]);
  });
});
