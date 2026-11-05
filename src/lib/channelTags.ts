import { eventLabel, parseChannelTags, type ChannelTags } from '../../shared/channels';
import { useCatalog } from '../store/catalog';
import type { Channel } from './types';

const cache = new WeakMap<Channel, ChannelTags>();

/** Tags for a catalogue channel (category name used as fallback), computed once per channel object. */
export function channelTags(ch: Channel): ChannelTags {
  let t = cache.get(ch);
  if (!t) {
    const index = useCatalog.getState().index;
    t = parseChannelTags(ch.name, index?.categoryById.get(ch.categoryId)?.name ?? '');
    // Before the categories are indexed the country can't come from them yet: don't keep that answer.
    if (index) cache.set(ch, t);
  }
  return t;
}

const labels = new WeakMap<Channel, string>();

/**
 * The name to show for a channel next to a match: event/PPV channels carry the whole fixture in
 * their name ("ENDED | EN ESPAÑOL-LEVANTE VS. … | US: ESPN+ PPV 6"), so only the provider slot is shown.
 */
export function feedName(ch: Channel): string {
  let l = labels.get(ch);
  if (l === undefined) {
    l = eventLabel(ch.name) ?? ch.name;
    labels.set(ch, l);
  }
  return l;
}
