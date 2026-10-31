import { useEffect, useRef } from 'react';
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
