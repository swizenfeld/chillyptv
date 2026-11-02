/**
 * Remote-control navigation (Fire TV / Android TV, or "Remote control navigation" in Settings):
 * the arrow keys move focus to the nearest focusable element in that direction, OK/Enter activates
 * it, and Back closes the open dialog or menu, else goes back. Lists that handle the arrows
 * themselves (the Live TV channel list) keep doing so: their handled keys are skipped here.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[role="option"]',
  '[role="tab"]',
].join(',');

type Dir = 'up' | 'down' | 'left' | 'right';
const DIRS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function visible(el: HTMLElement): boolean {
  if (el.closest('[aria-hidden="true"], [inert]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
}

/** The area navigation is confined to: an open dialog, else the whole page. */
function scope(): ParentNode {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return dialogs.length ? dialogs[dialogs.length - 1] : document;
}

function candidates(): HTMLElement[] {
  // Rows of a focusable listbox (Live TV channels) aren't stops: the list is, and moves its own selection.
  return [...scope().querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => visible(el) && !(el.getAttribute('role') === 'option' && el.closest('[role="listbox"][tabindex]')));
}

/**
 * The nearest candidate in `dir`: along the direction counts once, across it counts three times,
 * so moving right picks the next thing on the same row before something further down.
 */
export function nextInDirection(from: DOMRect, dir: Dir, list: { el: HTMLElement; r: DOMRect }[]): HTMLElement | null {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const { el, r } of list) {
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    let along: number;
    let across: number;
    if (dir === 'right') {
      if (r.left < from.right - 4) continue;
      along = r.left - from.right;
      across = Math.max(0, Math.abs(y - cy) - (r.height + from.height) / 4);
    } else if (dir === 'left') {
      if (r.right > from.left + 4) continue;
      along = from.left - r.right;
      across = Math.max(0, Math.abs(y - cy) - (r.height + from.height) / 4);
    } else if (dir === 'down') {
      if (r.top < from.bottom - 4) continue;
      along = r.top - from.bottom;
      across = Math.max(0, Math.abs(x - cx) - (r.width + from.width) / 4);
    } else {
      if (r.bottom > from.top + 4) continue;
      along = from.top - r.bottom;
      across = Math.max(0, Math.abs(x - cx) - (r.width + from.width) / 4);
    }
    const score = along + across * 3;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function focus(el: HTMLElement): void {
  if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function typing(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button', 'submit', 'color'].includes(el.type);
}

/** Closes the top dialog or menu if there is one (Escape); returns whether it did. */
export function closeOverlay(): boolean {
  if (!document.querySelector('[role="dialog"], [role="menu"], .player-menu')) return false;
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  return true;
}

let installed = false;

export function installSpatialNav(): void {
  if (installed) return;
  installed = true;
  document.documentElement.classList.add('tv-mode');
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    // The full-screen web player has its own keys (seek, zap, volume).
    if (document.querySelector('.player-full')) return;
    const active = document.activeElement as HTMLElement | null;
    const dir = DIRS[e.key];
    if (dir) {
      if (typing(active) && (dir === 'left' || dir === 'right')) return; // move the text cursor
      const list = candidates();
      if (!list.length) return;
      const from = active && active !== document.body && list.includes(active) ? active : null;
      if (!from) {
        e.preventDefault();
        focus(list[0]);
        return;
      }
      const next = nextInDirection(
        from.getBoundingClientRect(),
        dir,
        list.filter((el) => el !== from && !el.contains(from) && !from.contains(el)).map((el) => ({ el, r: el.getBoundingClientRect() })),
      );
      if (next) {
        e.preventDefault();
        focus(next);
      }
      return;
    }
    // OK on something that isn't natively clickable by keyboard (rows, cards with roles).
    if (e.key === 'Enter' && active && active !== document.body && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) {
      e.preventDefault();
      active.click();
    }
  });
}
