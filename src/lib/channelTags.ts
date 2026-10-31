import { parseChannelTags, type ChannelTags } from '../../shared/channels';
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
