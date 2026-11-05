import { canonicalRegion } from '../../shared/guide';

/** Free country guides offered when a playlist has many channels from that country without one. */
export interface GuideSuggestion {
  key: string;
  label: string;
  url: string;
  source: string;
  /** Channel country tags it serves ("LAT|" sports feeds are mostly the southern-cone ones). */
  regions: string[];
}

export const GUIDE_SUGGESTIONS: GuideSuggestion[] = [
  { key: 'AR', label: 'Argentina', url: 'https://iptv-epg.org/files/epg-ar.xml', source: 'iptv-epg.org', regions: ['AR', 'LAT'] },
];

/** Suggestions worth showing: at least `min` channels they'd serve have no guide, and not added yet. */
export function guideSuggestions(missingByRegion: Map<string, number>, added: string[], min = 10): { suggestion: GuideSuggestion; missing: number }[] {
  const have = new Set(added.map((u) => u.trim().toLowerCase()));
  return GUIDE_SUGGESTIONS.map((suggestion) => ({
    suggestion,
    missing: suggestion.regions.reduce((n, r) => n + (missingByRegion.get(canonicalRegion(r) ?? r) ?? 0), 0),
  })).filter(({ suggestion, missing }) => missing >= min && !have.has(suggestion.url.toLowerCase()));
}
