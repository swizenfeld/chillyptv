import { describe, expect, it } from 'vitest';
import { newReleases } from '../../src/lib/releases';
import type { Movie } from '../../src/lib/types';

const NOW = Date.UTC(2026, 10, 1);
let n = 0;
const m = (name: string, year?: number, added = 0): Movie => ({ id: String(++n), name, categoryId: '1', year, added });

describe('new releases', () => {
  it('orders by release year, then by when the provider added it', () => {
    const list = newReleases([m('Old Classic', 1999, 9e12), m('Late 2025', 2025, 5), m('Early 2026', 2026, 1), m('Fresh 2026', 2026, 9)], { now: NOW });
    expect(list.map((x) => x.name)).toEqual(['Fresh 2026', 'Early 2026', 'Late 2025']);
  });
  it('skips future-year placeholders and undated films', () => {
    expect(newReleases([m('Typo', 2098), m('No year'), m('Real', 2026)], { now: NOW }).map((x) => x.name)).toEqual(['Real']);
  });
  it('counts copies of one film once', () => {
    const list = newReleases([m('EN - Dune Part Two (2026) 4K', 2026, 3), m('LAT| Dune Part Two (2026)', 2026, 2), m('Dune Part Two (2026) [ES]', 2026, 1)], { now: NOW });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('EN - Dune Part Two (2026) 4K');
  });
  it('reaches back further only to fill a thin row', () => {
    const many = Array.from({ length: 12 }, (_, i) => m(`New ${i}`, 2026, i));
    expect(newReleases([...many, m('Older', 2023)], { now: NOW }).some((x) => x.name === 'Older')).toBe(false);
    expect(newReleases([m('Only', 2026), m('Older', 2023)], { now: NOW }).map((x) => x.name)).toEqual(['Only', 'Older']);
  });
});

describe("provider's new-releases category", () => {
  const count = (id: string) => ({ a: 955, b: 300, c: 40, d: 0, e: 500 })[id] ?? 0;
  it('finds it by name, English first', async () => {
    const { releaseCategory } = await import('../../src/lib/releases');
    const cats = [
      { id: 'e', name: '|EN| ACTION' },
      { id: 'b', name: '|LAT| ESTRENOS' },
      { id: 'a', name: '|EN| NEW RELEASED' },
      { id: 'c', name: 'NEW RELEASES 4K' },
    ];
    expect(releaseCategory(cats, count)?.id).toBe('a');
    expect(releaseCategory(cats.filter((c) => c.id !== 'a'), count)?.id).toBe('b'); // largest when none is English
    expect(releaseCategory([{ id: 'e', name: '|EN| ACTION' }], count)).toBeUndefined();
    expect(releaseCategory([{ id: 'd', name: '|EN| NEW RELEASED' }], count)).toBeUndefined(); // empty
  });
});
