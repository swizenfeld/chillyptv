import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { imageUrl } from '../lib/api';
import { useToasts } from '../store/toast';

export function Spinner({ size = 28, label }: { size?: number; label?: string }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <div className="spinner" style={{ width: size, height: size }} />
      {label && <span>{label}</span>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

const failed = new Set<string>();

/** Image with lazy loading and a generated fallback tile (initials). */
export function Img({ src, alt, className, fallbackText, rounded }: { src?: string; alt: string; className?: string; fallbackText?: string; rounded?: boolean }) {
  const url = imageUrl(src);
  const [err, setErr] = useState(() => !url || failed.has(url));
  useEffect(() => setErr(!url || failed.has(url)), [url]);
  if (err || !url) {
    const text = (fallbackText ?? alt)
      .replace(/^[A-Z]{2,3}\s*[:|-]\s*/, '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
    let h = 0;
    for (const c of alt) h = (h * 31 + c.charCodeAt(0)) % 360;
    return (
      <div className={`img-fallback ${className ?? ''} ${rounded ? 'rounded' : ''}`} style={{ background: `linear-gradient(135deg, hsl(${h} 55% 35%), hsl(${(h + 50) % 360} 55% 20%))` }} aria-label={alt}>
        <span>{text || '?'}</span>
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={`${className ?? ''} ${rounded ? 'rounded' : ''}`}
      onError={() => {
        failed.add(url);
        setErr(true);
      }}
    />
  );
}

export function Modal({ title, onClose, children, wide, footer }: { title?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, button:not(.modal-close), select, textarea, [tabindex="0"]');
    (first ?? ref.current)?.focus();
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" ref={ref} tabIndex={-1}>
        <div className="modal-head">
          {title && <h2>{title}</h2>}
          <button className="icon-btn modal-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span>{t.message}</span>
          {t.action && (
            <button
              className="btn small primary"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={`progress ${className ?? ''}`}>
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: 'small' }) {
  return (
    <div className={`segmented ${size ?? ''}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="toggle-row">
      <div>
        <div className="toggle-label">{label}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** Re-renders every `ms` milliseconds; returns the current time. */
export function useNow(ms = 30000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
