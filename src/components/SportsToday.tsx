import { useMemo, useState } from 'react';
import { Trophy } from 'lucide-react';
import { LEAGUE_BY_ID, type LeagueGroup } from '../../shared/sports';
import type { SportsMatch, SportsToday as SportsData } from '../store/sports';
import type { Channel } from '../lib/types';
import { useSettings } from '../store/settings';
import { formatClock } from '../lib/format';
import { quickFilter } from '../lib/search';
import { Empty, Img, Spinner } from './ui';

const GROUP_LABEL: Record<LeagueGroup, string> = { MLS: 'MLS', Champions: 'Champions', England: 'England', Spain: 'Spain', Argentina: 'Argentina' };

export function SportsToday({ data, filter, selectedId, onSelect, onOpen }: {
  data: SportsData;
  filter: string;
  selectedId?: string;
  onSelect: (c: Channel) => void;
  onOpen: (c: Channel) => void;
}) {
  const [group, setGroup] = useState<LeagueGroup | 'all'>('all');
  const groups = useMemo(() => {
    const present = new Set(data.matches.map((m) => LEAGUE_BY_ID.get(m.fixture.leagueId)?.group).filter(Boolean) as LeagueGroup[]);
    return (Object.keys(GROUP_LABEL) as LeagueGroup[]).filter((g) => present.has(g));
  }, [data.matches]);

  const matches = useMemo(() => {
    const byGroup = group === 'all' ? data.matches : data.matches.filter((m) => LEAGUE_BY_ID.get(m.fixture.leagueId)?.group === group);
    return quickFilter(byGroup, filter, (m) => `${m.fixture.home.name} ${m.fixture.away.name} ${m.fixture.leagueName} ${m.channels.map((c) => c.channel.name).join(' ')}`);
  }, [data.matches, group, filter]);

  if (data.loading && !data.matches.length) return <Spinner label="Checking today's fixtures…" />;

  const sections: [string, SportsMatch[]][] = [
    ['Live now', matches.filter((m) => m.state === 'in')],
    ['Coming up', matches.filter((m) => m.state === 'pre')],
    ['Finished', matches.filter((m) => m.state === 'post')],
  ];

  return (
    <div className="sports">
      <div className="sports-head">
        <div className="sports-chips" role="tablist" aria-label="Competitions">
          {(['all', ...groups] as (LeagueGroup | 'all')[]).map((g) => (
            <button key={g} role="tab" aria-selected={group === g} className={group === g ? 'active' : ''} onClick={() => setGroup(g)}>
              {g === 'all' ? 'All' : GROUP_LABEL[g]}
            </button>
          ))}
        </div>
        <p className="sports-source">
          {data.source === 'feed' ? 'Fixtures from ESPN, matched to your TV guide and channel names.' : 'Matches found in your TV guide.'}
          {data.feedError && ` ${data.feedError}, so only guide listings are shown.`}
        </p>
      </div>
      {!matches.length ? (
        <Empty icon={<Trophy size={36} />} title={filter ? `No matches for “${filter}”` : 'No matches today'}>
          {!filter && <EmptyReason data={data} />}
        </Empty>
      ) : (
        <div className="sports-scroll">
          {sections.map(([label, list]) =>
            list.length ? (
              <section key={label} className="sports-section">
                <h3>
                  {label} <span className="count">{list.length}</span>
                </h3>
                {list.map((m) => (
                  <MatchCard key={m.fixture.id} m={m} selectedId={selectedId} onSelect={onSelect} onOpen={onOpen} />
                ))}
              </section>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

function MatchCard({ m, selectedId, onSelect, onOpen }: { m: SportsMatch; selectedId?: string; onSelect: (c: Channel) => void; onOpen: (c: Channel) => void }) {
  const clock24 = useSettings((s) => s.clock24);
  const f = m.fixture;
  const showScore = m.state !== 'pre' && f.home.score !== undefined;
  const status =
    m.state === 'in' ? (
      <span className="live-pill">{f.detail && f.detail !== '0\'' ? f.detail : 'Live'}</span>
    ) : m.state === 'post' ? (
      <span className="match-ft">{f.detail ?? 'FT'}</span>
    ) : (
      <span className="match-time tabular">{formatClock(f.start, clock24)}</span>
    );
  return (
    <article className={`match-card state-${m.state}`}>
      <header className="match-head">
        <span className="match-league">{f.leagueName}</span>
        {status}
      </header>
      {[f.home, f.away].map((t, i) => (
        <div key={i} className="match-team">
          {t.logo ? <Img src={t.logo} alt="" className="team-logo" /> : <span className="team-logo blank" aria-hidden />}
          <span className="team-name">{t.name}</span>
          {showScore && <span className="team-score tabular">{t.score}</span>}
        </div>
      ))}
      {m.channels.length ? (
        <div className="match-channels" aria-label={`Channels showing ${f.home.name} v ${f.away.name}`}>
          {m.channels.slice(0, 6).map((c) => (
            <button
              key={c.channel.id}
              className={`match-ch ${selectedId === c.channel.id ? 'active' : ''} ${c.score < 1 ? 'weak' : ''}`}
              onClick={() => onSelect(c.channel)}
              onDoubleClick={() => onOpen(c.channel)}
              title={c.via === 'broadcaster' ? `${c.channel.name} is listed as a broadcaster; the guide doesn't confirm it` : c.via === 'channel' ? 'The channel name lists this match' : c.programme?.title}
            >
              <Img src={c.channel.logo} alt="" className="match-ch-logo" />
              <span className="match-ch-name">{c.channel.name}</span>
              {c.score < 1 && <span className="match-ch-hint">{c.via === 'broadcaster' ? 'maybe' : 'likely'}</span>}
            </button>
          ))}
        </div>
      ) : (
        <p className="match-none">{f.broadcasts.length ? `Not found in your channels · TV: ${f.broadcasts.slice(0, 3).join(', ')}` : 'Not found in your channels'}</p>
      )}
    </article>
  );
}

/** Says why the list is empty, so the cause is visible instead of guessed. */
function EmptyReason({ data }: { data: SportsData }) {
  const d = data.diagnostics;
  const n = (x: number) => x.toLocaleString();
  return (
    <div className="sports-why">
      {d.feed === 'ok' && <p>ESPN lists no matches today for the competitions you follow ({d.feedFixtures} fixtures). Choose more competitions in Settings → Sports.</p>}
      {d.feed !== 'ok' && d.programmesToday === 0 && (
        <p>
          Your provider's TV guide has no listings for today, so matches can only be found through the online fixtures feed
          {d.feed === 'off' ? ', which is turned off in Settings → Sports.' : ', which is unavailable right now.'}
        </p>
      )}
      {d.feed !== 'ok' && d.programmesToday > 0 && <p>No programme titles in today's guide name a match from the competitions you follow.</p>}
      <dl className="sports-diag">
        <div>
          <dt>Online fixtures</dt>
          <dd>{d.feed === 'ok' ? `OK · ${d.feedFixtures} today` : d.feed === 'off' ? 'Off' : (data.feedError ?? 'Unavailable')}</dd>
        </div>
        <div>
          <dt>TV guide today</dt>
          <dd>
            {n(d.programmesToday)} listings on {n(d.channelsWithGuide)} of {n(d.channels)} channels
          </dd>
        </div>
      </dl>
    </div>
  );
}
