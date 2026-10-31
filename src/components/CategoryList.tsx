import { useMemo, useState } from 'react';
import { Lock, Search } from 'lucide-react';
import { quickFilter } from '../lib/search';
import { useParental } from './Parental';
import { useSettings } from '../store/settings';
import type { Category } from '../lib/types';

export interface SpecialCategory {
  id: string;
  name: string;
  icon?: React.ReactNode;
  count?: number;
}

export function CategoryList({ categories, counts, special, value, onChange }: {
  categories: Category[];
  counts: Map<string, number>;
  special: SpecialCategory[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const hidden = useSettings((s) => s.hiddenCategories);
  const hideLocked = useSettings((s) => s.hideLockedContent);
  const { guard, locked } = useParental();
  const visible = useMemo(() => {
    const hs = new Set(hidden);
    return quickFilter(
      categories.filter((c) => !hs.has(c.id) && !(hideLocked && locked(c.id, c.name))),
      q,
      (c) => c.name,
    );
  }, [categories, hidden, q, hideLocked, locked]);

  return (
    <aside className="cat-list">
      <div className="search-box small">
        <Search size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter categories" aria-label="Filter categories" />
      </div>
      <div className="cat-scroll" role="listbox" aria-label="Categories">
        {!q &&
          special.map((s) => (
            <button key={s.id} role="option" aria-selected={value === s.id} className={`cat-item special ${value === s.id ? 'active' : ''}`} onClick={() => onChange(s.id)}>
              {s.icon}
              <span className="cat-name">{s.name}</span>
              {s.count !== undefined && <span className="cat-count">{s.count}</span>}
            </button>
          ))}
        {visible.map((c) => {
          const isLocked = locked(c.id, c.name);
          return (
            <button
              key={c.id}
              role="option"
              aria-selected={value === c.id}
              className={`cat-item ${value === c.id ? 'active' : ''}`}
              onClick={() => guard(c.id, c.name, () => onChange(c.id))}
            >
              {isLocked && <Lock size={14} />}
              <span className="cat-name">{c.name}</span>
              <span className="cat-count">{counts.get(c.id) ?? 0}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
