import { describe, expect, it } from 'vitest';
import { compareRank, feedRank, parseChannelTags, type FeedPrefs } from '../../shared/channels';

describe('channel name tags', () => {
  it.each([
    ['LAT| ESPN 2 FHD', { region: 'LAT', lang: 'es', quality: 'fhd', base: 'espn 2' }],
    ['UK: Sky Sports Main Event 4K', { region: 'UK', lang: 'en', quality: 'uhd', base: 'sky sports main event' }],
    ['AR - TNT Sports HD', { region: 'AR', lang: 'es', quality: 'hd', base: 'tnt sports' }],
    ['ESPN Premium ᴿᴬᵂ', { variant: 'RAW', quality: 'unknown', base: 'espn premium' }],
    ['beIN Sports [EN] 1080p', { lang: 'en', quality: 'fhd', base: 'bein sports' }],
    ['DAZN LaLiga ESPAÑOL HEVC', { lang: 'es', quality: 'fhd', base: 'dazn laliga' }],
    ['US| FOX Sports 1 SD', { region: 'US', lang: 'en', quality: 'sd', base: 'fox sports 1' }],
  ])('%s', (name, expected) => {
    expect(parseChannelTags(name)).toMatchObject(expected);
  });
  it('takes region and language from the category when the name has no prefix', () => {
    expect(parseChannelTags('ESPN 3', 'LAT| ARGENTINA')).toMatchObject({ region: 'LAT', lang: 'es', base: 'espn 3' });
  });
  it('does not treat words or channel numbers as a region', () => {
    expect(parseChannelTags('Sky Sports: Premier League').region).toBeUndefined();
    expect(parseChannelTags('Canal 13').region).toBeUndefined();
  });
});

describe('feed ranking', () => {
  const prefs: FeedPrefs = { languages: ['es', 'en'], maxQuality: 'uhd' };
  const rank = (name: string, p = prefs) => feedRank(parseChannelTags(name), p);
  const sort = (names: string[], p = prefs) => [...names].sort((a, b) => compareRank(rank(a, p), rank(b, p)));
  it('preferred language first, then the best quality, then the main feed over raw/backup', () => {
    expect(sort(['UK: TNT Sports 4K', 'LAT| ESPN SD', 'LAT| ESPN FHD', 'LAT| ESPN FHD RAW', 'LAT| ESPN HD'])).toEqual([
      'LAT| ESPN FHD', 'LAT| ESPN FHD RAW', 'LAT| ESPN HD', 'LAT| ESPN SD', 'UK: TNT Sports 4K',
    ]);
  });
  it('a quality cap prefers FHD over 4K', () => {
    expect(sort(['LAT| ESPN 4K', 'LAT| ESPN FHD', 'LAT| ESPN SD'], { ...prefs, maxQuality: 'fhd' })).toEqual(['LAT| ESPN FHD', 'LAT| ESPN 4K', 'LAT| ESPN SD']);
  });
  it('an unknown language ranks below the preferred ones but above other known languages', () => {
    expect(sort(['IT: Sky Calcio HD', 'Sports 1 HD', 'UK: Sky Sports HD'])).toEqual(['UK: Sky Sports HD', 'Sports 1 HD', 'IT: Sky Calcio HD']);
  });
});
