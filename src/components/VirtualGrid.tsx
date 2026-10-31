import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/** Row-virtualised responsive grid (for thousands of posters). */
export function VirtualGrid<T>({ items, render, minWidth = 150, aspect = 1.5, extra = 52, resetKey }: { items: T[]; render: (item: T) => ReactNode; minWidth?: number; aspect?: number; extra?: number; resetKey?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [resetKey]);
  const gap = 14;
  const cols = Math.max(2, Math.floor((width - 8 + gap) / (minWidth + gap)));
  const cardW = (width - 8 - gap * (cols - 1)) / cols;
  const rowH = cardW * aspect + extra + gap;
  const rows = Math.ceil(items.length / cols);
  const v = useVirtualizer({ count: rows, getScrollElement: () => ref.current, estimateSize: () => rowH, overscan: 3 });
  useEffect(() => v.measure(), [rowH, v]);
  return (
    <div className="v-grid" ref={ref}>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((r) => (
          <div key={r.index} className="v-grid-row" style={{ transform: `translateY(${r.start}px)`, gridTemplateColumns: `repeat(${cols}, 1fr)`, gap }}>
            {items.slice(r.index * cols, r.index * cols + cols).map(render)}
          </div>
        ))}
      </div>
    </div>
  );
}
