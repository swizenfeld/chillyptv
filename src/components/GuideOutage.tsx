import { AlertTriangle } from 'lucide-react';
import { useEpg } from '../store/epg';
import { useNow } from './ui';

function ago(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'}`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `${d} days`;
}

/** Why the provider's guide is missing, what's shown instead, and that it's being retried. */
export function GuideOutageNote() {
  const outage = useEpg((s) => s.outage);
  const fetchedAt = useEpg((s) => s.data?.fetchedAt);
  const now = useNow(60_000);
  if (!outage) return null;
  const code = outage.error.match(/HTTP (\d{3})/)?.[1];
  const why = code === '404' ? 'returns “not found”' : code ? `returns an error (HTTP ${code})` : 'can’t be reached';
  return (
    <div className="guide-outage" role="status">
      <AlertTriangle size={16} aria-hidden />
      <span>
        Your provider’s TV guide {why}, for {ago(now - outage.since)} now.{' '}
        {fetchedAt
          ? `Showing the copy saved ${ago(now - fetchedAt)} ago.`
          : 'Event channels still show their own times, and the channel you watch asks the provider for its listings.'}{' '}
        ChillyPTV tries again every hour.
      </span>
    </div>
  );
}
