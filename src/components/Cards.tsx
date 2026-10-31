import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Heart, Lock, Play, Star } from 'lucide-react';
import { Img, ProgressBar } from './ui';
import { formatMinutes } from '../lib/format';
import type { Channel, Programme } from '../lib/types';

/** Inline "See all ›" link that sits right after a row title. */
export function RowLink({ to, children = 'See all' }: { to: string; children?: ReactNode }) {
  return (
    <Link className="row-link" to={to}>
      {children}
      <ChevronRight size={16} aria-hidden />
    </Link>
  );
}

/** Horizontal content row with paging arrows on pointer devices. */
export function Row({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update]);
  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };
  return (
    <section className="row-section">
      <div className="row-head inline">
        <h2>{title}</h2>
        {action}
      </div>
      <div className="row-scroller">
        {!edges.start && (
          <button className="row-arrow prev" onClick={() => page(-1)} aria-label="Scroll left" tabIndex={-1}>
            <ChevronLeft size={22} />
          </button>
        )}
        <div className="h-scroll" ref={ref} onScroll={update}>
          {children}
        </div>
        {!edges.end && (
          <button className="row-arrow next" onClick={() => page(1)} aria-label="Scroll right" tabIndex={-1}>
            <ChevronRight size={22} />
          </button>
        )}
      </div>
    </section>
  );
}

export function PosterCard({ title, image, subtitle, rating, progress, onClick, favorite, onFavorite, locked }: {
  title: string;
  image?: string;
  subtitle?: ReactNode;
  rating?: number;
  progress?: number;
  onClick: () => void;
  favorite?: boolean;
  onFavorite?: () => void;
  locked?: boolean;
}) {
  return (
    <div className="poster-card">
      <button className="poster-btn" onClick={onClick} title={title}>
        <div className="poster-img">
          {locked ? <div className="img-fallback locked"><Lock size={28} aria-label="Locked" /></div> : <Img src={image} alt={title} />}
          {rating !== undefined && rating > 0 && (
            <span className="poster-rating">
              <Star size={11} fill="currentColor" /> {rating.toFixed(1)}
            </span>
          )}
          <span className="poster-play">
            <Play size={28} fill="currentColor" />
          </span>
          {progress !== undefined && progress > 0 && <ProgressBar value={progress} className="poster-progress" />}
        </div>
        <div className="poster-title">{locked ? 'Locked' : title}</div>
        {subtitle && <div className="poster-sub">{subtitle}</div>}
      </button>
      {onFavorite && (
        <button className={`fav-btn ${favorite ? 'on' : ''}`} onClick={onFavorite} aria-label={favorite ? 'Remove from favourites' : 'Add to favourites'}>
          <Heart size={16} fill={favorite ? 'currentColor' : 'none'} />
        </button>
      )}
    </div>
  );
}

export function WideCard({ title, image, subtitle, progress, onClick, badge }: { title: string; image?: string; subtitle?: ReactNode; progress?: number; onClick: () => void; badge?: ReactNode }) {
  return (
    <button className="wide-card" onClick={onClick} title={title}>
      <div className="wide-img">
        <Img src={image} alt={title} />
        {badge && <span className="wide-badge">{badge}</span>}
        <span className="poster-play">
          <Play size={24} fill="currentColor" />
        </span>
        {progress !== undefined && progress > 0 && <ProgressBar value={progress} className="poster-progress" />}
      </div>
      <div className="wide-title">{title}</div>
      {subtitle && <div className="poster-sub">{subtitle}</div>}
    </button>
  );
}

/** Stable hue per channel so logo-only artwork still feels distinct. */
export function channelHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** 16:9 "Live & upcoming" style card: what is on now, how long is left. */
export function LiveCard({ channel, programme, now, onClick }: { channel: Channel; programme?: Programme; now: number; onClick: () => void }) {
  const left = programme ? Math.max(0, programme.end - now) / 1000 : 0;
  return (
    <button className="live-card" onClick={onClick} title={`Watch ${channel.name}`}>
      <div className="live-card-art" style={{ '--hue': channelHue(channel.name) } as React.CSSProperties}>
        <Img src={channel.logo} alt={channel.name} className="live-card-logo" />
        <span className="live-pill">Live</span>
        <span className="poster-play">
          <Play size={24} fill="currentColor" />
        </span>
        {programme && <ProgressBar value={(now - programme.start) / (programme.end - programme.start)} className="poster-progress" />}
      </div>
      <div className="wide-title">{programme?.title ?? channel.name}</div>
      <div className="poster-sub">
        {channel.name}
        {programme ? ` · ${formatMinutes(left)} left` : ''}
      </div>
    </button>
  );
}
