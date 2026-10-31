import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Toggle } from './ui';
import { DEFAULT_LEAGUES, GROUPS, LEAGUES, REGIONS, type LeagueGroup } from '../../shared/sports';
import { useSettings } from '../store/settings';

/** Competition picker for "Sports today": regions → groups → competitions. */
export function SportsSettings() {
  const selected = useSettings((s) => s.sportsLeagues);
  const set = useSettings((s) => s.set);
  const chosen = new Set(selected);
  const update = (ids: string[], on: boolean) => {
    const next = new Set(chosen);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    // Keep catalogue order so requests and the settings blob stay stable.
    set({ sportsLeagues: LEAGUES.map((l) => l.id).filter((id) => next.has(id)) });
  };

  return (
    <div className="sports-settings">
      <TeamsAndFeeds />
      <h3 className="sports-settings-sub">Competitions</h3>
      <div className="sports-settings-bar">
        <span className="muted">
          {chosen.size} of {LEAGUES.length} competitions followed
        </span>
        <div className="row gap">
          <button className="btn small" onClick={() => set({ sportsLeagues: DEFAULT_LEAGUES })}>
            Defaults
          </button>
          <button className="btn small" onClick={() => update(LEAGUES.map((l) => l.id), true)}>
            All
          </button>
          <button className="btn small" onClick={() => update(LEAGUES.map((l) => l.id), false)}>
            None
          </button>
        </div>
      </div>
      {REGIONS.map((region) => (
        <section key={region} className="league-region">
          <h3>{region}</h3>
          <div className="league-groups">
            {GROUPS.filter((g) => g.region === region).map((g) => (
              <GroupBox key={g.id} group={g.id} chosen={chosen} onChange={update} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function GroupBox({ group, chosen, onChange }: { group: LeagueGroup; chosen: Set<string>; onChange: (ids: string[], on: boolean) => void }) {
  const leagues = LEAGUES.filter((l) => l.group === group);
  const ids = leagues.map((l) => l.id);
  const count = ids.filter((id) => chosen.has(id)).length;
  const all = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (all.current) all.current.indeterminate = count > 0 && count < ids.length;
  }, [count, ids.length]);
  return (
    <fieldset className="league-group">
      <legend>
        <label className="check group-check">
          <input ref={all} type="checkbox" checked={count === ids.length} onChange={(e) => onChange(ids, e.target.checked)} aria-label={`All of ${group}`} />
          {group}
        </label>
      </legend>
      {leagues.map((l) => (
        <label key={l.id} className="check">
          <input type="checkbox" checked={chosen.has(l.id)} onChange={(e) => onChange([l.id], e.target.checked)} />
          {l.name}
        </label>
      ))}
    </fieldset>
  );
}

const LANGS: [string, string][] = [
  ['es', 'Spanish'],
  ['en', 'English'],
  ['pt', 'Portuguese'],
  ['it', 'Italian'],
  ['fr', 'French'],
  ['de', 'German'],
];

/** Followed teams, kick-off alerts and how the best feed of a match is chosen. */
function TeamsAndFeeds() {
  const s = useSettings();
  const [team, setTeam] = useState('');
  const add = () => {
    const name = team.trim();
    if (!name || s.followedTeams.some((t) => t.name.toLowerCase() === name.toLowerCase())) return;
    s.set({ followedTeams: [...s.followedTeams, { name }] });
    setTeam('');
  };
  const [first, second] = [s.feedLanguages[0] ?? 'en', s.feedLanguages[1] ?? ''];
  const setLangs = (a: string, b: string) => s.set({ feedLanguages: [a, b].filter((x, i, arr) => x && arr.indexOf(x) === i) });
  return (
    <>
      <h3 className="sports-settings-sub">Teams you follow</h3>
      <p className="hint">Their matches are pinned at the top of Sports today and on Home. Tip: tap the star next to a team on any match card.</p>
      <div className="team-chips">
        {s.followedTeams.map((t) => (
          <span key={t.name} className="team-chip">
            {t.name}
            <button onClick={() => s.set({ followedTeams: s.followedTeams.filter((x) => x !== t) })} aria-label={`Unfollow ${t.name}`}>
              <X size={13} />
            </button>
          </span>
        ))}
        <form
          className="team-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input className="input" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Add a team, e.g. Boca Juniors" aria-label="Team name" />
          <button className="btn small" disabled={!team.trim()}>
            Follow
          </button>
        </form>
      </div>
      <div className="setting">
        <span>Kick-off alert</span>
        <select className="select" value={s.teamAlertMinutes} onChange={(e) => s.set({ teamAlertMinutes: Number(e.target.value) })} aria-label="Kick-off alert">
          <option value={0}>Off</option>
          <option value={5}>5 minutes before</option>
          <option value={10}>10 minutes before</option>
          <option value={15}>15 minutes before</option>
          <option value={30}>30 minutes before</option>
        </select>
      </div>

      <h3 className="sports-settings-sub">Best feed</h3>
      <p className="hint">When several channels show a match, the best one is listed first and the others fold away.</p>
      <div className="setting">
        <span>Commentary language</span>
        <div className="row gap">
          <select className="select" value={first} onChange={(e) => setLangs(e.target.value, second === e.target.value ? first : second)} aria-label="First choice language">
            {LANGS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <span className="muted small">then</span>
          <select className="select" value={second} onChange={(e) => setLangs(first, e.target.value)} aria-label="Second choice language">
            <option value="">Any</option>
            {LANGS.filter(([v]) => v !== first).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="setting">
        <span>
          Highest quality to prefer
          <small className="hint">Lower it if 4K streams buffer on your connection</small>
        </span>
        <select className="select" value={s.feedMaxQuality} onChange={(e) => s.set({ feedMaxQuality: e.target.value as typeof s.feedMaxQuality })} aria-label="Highest quality">
          <option value="uhd">4K</option>
          <option value="fhd">Full HD</option>
          <option value="hd">HD</option>
        </select>
      </div>
      <Toggle
        checked={s.autoFailover}
        onChange={(autoFailover) => s.set({ autoFailover })}
        label="Switch to a backup feed automatically"
        hint="If the channel you're watching stops, the player moves to the next feed of the same match."
      />
    </>
  );
}
