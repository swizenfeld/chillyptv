import { QUALITY_LABEL, QUALITY_RANK } from '../../shared/channels';
import { channelTags } from './channelTags';
import type { Catalog, Channel } from './types';

/**
 * A tidier Live TV: event slots that are empty ("- NO EVENT STREAMING -") or finished are hidden,
 * and regional copies of one channel ("MXC| AZTECA 7 (ALTAMIRA)", "(CAMPECHE)"… 55 of them) show
 * as one entry with a city picker. Computed once per catalogue and options.
 */
export interface TidyView {
  /** Channel ids left out of lists, counts and zapping. */
  hidden: Set<string>;
  /** Representative id → every version (representative first). */
  groups: Map<string, Channel[]>;
  /** Any version's id → its representative's id. */
  repOf: Map<string, string>;
}

const CITY_RE = /\(([^)]+)\)\s*(?:\b(?:fhd|hd|sd|4k|uhd)\b\s*)?$/i;

/** "MXC| AZTECA 7 (ALTAMIRA)" → "Altamira"; "MXC| CANAL 5 HD" → "HD"; "MXC| CANAL 5" → "Main". */
export function versionLabel(ch: Channel): string {
  const city = ch.name.match(CITY_RE)?.[1];
  const q = QUALITY_LABEL[channelTags(ch).quality];
  const name = city ? city.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()) : 'Main';
  return q ? `${name} · ${q}` : name;
}

const cache = new WeakMap<Catalog, Map<string, TidyView>>();

export function tidyView(catalog: Catalog, opts: { showEventSlots: boolean; groupRegional: boolean }): TidyView {
  const key = `${opts.showEventSlots}|${opts.groupRegional}`;
  let per = cache.get(catalog);
  if (!per) cache.set(catalog, (per = new Map()));
  const hit = per.get(key);
  if (hit) return hit;

  const hidden = new Set<string>();
  const groups = new Map<string, Channel[]>();
  const repOf = new Map<string, string>();
  if (!opts.showEventSlots) {
    for (const ch of catalog.channels) {
      const ev = channelTags(ch).event;
      if (ev === 'idle' || ev === 'ended') hidden.add(ch.id);
    }
  }
  if (opts.groupRegional) {
    const byBase = new Map<string, Channel[]>();
    for (const ch of catalog.channels) {
      if (hidden.has(ch.id)) continue;
      const base = channelTags(ch).base;
      if (!base) continue;
      const k = `${ch.categoryId}|${base}`;
      (byBase.get(k) ?? byBase.set(k, []).get(k)!).push(ch);
    }
    for (const list of byBase.values()) {
      // Only real regional sets: several versions, at least two of them named after a city.
      if (list.length < 3 || list.filter((c) => CITY_RE.test(c.name)).length < 2) continue;
      const plain = list.filter((c) => !CITY_RE.test(c.name));
      const pool = plain.length ? plain : list;
      const rep = pool.reduce((a, b) => (QUALITY_RANK[channelTags(b).quality] > QUALITY_RANK[channelTags(a).quality] ? b : a));
      const ordered = [rep, ...list.filter((c) => c !== rep).sort((a, b) => versionLabel(a).localeCompare(versionLabel(b)))];
      groups.set(rep.id, ordered);
      for (const c of ordered) {
        repOf.set(c.id, rep.id);
        if (c !== rep) hidden.add(c.id);
      }
    }
  }
  const view = { hidden, groups, repOf };
  per.set(key, view);
  return view;
}
