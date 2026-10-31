import type { ReactNode } from 'react';
import { Heart, Lock, Play, Star } from 'lucide-react';
import { Img, ProgressBar } from './ui';

export function Row({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="row-section">
      <div className="row-head">
        <h2>{title}</h2>
        {action}
      </div>
      <div className="h-scroll">{children}</div>
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

export function ChannelTile({ name, logo, now, onClick, num }: { name: string; logo?: string; now?: string; onClick: () => void; num?: number }) {
  return (
    <button className="channel-tile" onClick={onClick} title={name}>
      <div className="channel-tile-logo">
        <Img src={logo} alt={name} />
      </div>
      <div className="channel-tile-name">
        {num !== undefined && <span className="ch-num">{num}</span>} {name}
      </div>
      {now && <div className="channel-tile-now">{now}</div>}
    </button>
  );
}
