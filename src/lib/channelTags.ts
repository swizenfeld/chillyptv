import { eventLabel, parseChannelTags, type ChannelTags } from '../../shared/channels';
import { useCatalog } from '../store/catalog';
import type { Channel } from './types';

const cache = new WeakMap<Channel, ChannelTags>();

/** Tags for a catalogue channel (category name used as fallback), computed once per channel object. */
export function channelTags(ch: Channel): ChannelTags {
  let t = cache.get(ch);
  if (!t) {
    const cat = useCatalog.getState().index?.categoryById.get(ch.categoryId)?.name ?? '';
    t = parseChannelTags(ch.name, cat);
    cache.set(ch, t);
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
