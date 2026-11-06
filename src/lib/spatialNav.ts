/**
 * Remote-control navigation (Fire TV / Android TV, or "Remote control navigation" in Settings):
 * the arrow keys move focus to the nearest focusable element in that direction, OK/Enter activates
 * it, and Back closes the open dialog or menu, else goes back. Lists that handle the arrows
 * themselves (the Live TV channel list) keep doing so: their handled keys are skipped here.
 *
 * TV conventions it follows:
 * - Columns ([data-nav-group="column"]: categories, channel list, info panel) come first: Left/Right
 *   go to the next column over, not to a button level with you two columns away; Up/Down stay in
 *   the column.
 * - A focusable list (Live TV channels) is one stop; nothing inside it is focused on its own.
 * - Text boxes keep Left/Right for the cursor, except at the start/end of the text.
 * - [data-autofocus] marks where a page or column starts; its value can name what to start on
 *   (".match-ch": the first match's first channel). [data-nav-minor] stops (a team's follow star)
 *   are only reached by moving straight at them, never as the nearest thing at an angle.
 * - Things in line with you come first: Down from a poster goes to the poster below it.
 * - Groups ([data-nav-group]: content rows, the sidebar, category lists) remember where you were;
 *   entering one again lands there, or on its current item (the page you're on, the category shown).
 * - Up/Down keep the focused item in the middle of the screen, so the row title above it and the
 *   next row stay visible; Left/Right slide a row along.
 * - At the end of what's loaded (virtual grids), the list scrolls on and the search is retried.
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
  // Anything inside a focusable listbox (Live TV channels: rows, their heart buttons) isn't a stop:
  // the list is, and moves its own selection. [data-nav-skip] marks things not worth stopping on.
  return [...scope().querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (!visible(el) || el.closest('[data-nav-skip]')) return false;
    const list = el.parentElement?.closest('[role="listbox"][tabindex]');
    return !list;
  });
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The best candidate in `dir`. Candidates overlapping `from` across the direction (the poster right
 * below, the button on the same line) win, nearest first; only if there are none does the closest
 * thing at an angle count, with sideways distance weighing double.
 */
export function nextInDirection(from: Box, dir: Dir, list: { el: HTMLElement; r: Box; minor?: boolean }[], inLineOnly = false): HTMLElement | null {
  const horizontal = dir === 'left' || dir === 'right';
  let best: HTMLElement | null = null;
  let bestKey: [number, number, number] = [2, Infinity, 0];
  for (const { el, r, minor } of list) {
    let along: number;
    if (dir === 'right') along = r.left - from.right;
    else if (dir === 'left') along = from.left - r.right;
    else if (dir === 'down') along = r.top - from.bottom;
    else along = from.top - r.bottom;
    // Beyond the current item's edge (a little overlap is allowed for tight layouts).
    const size = horizontal ? from.right - from.left : from.bottom - from.top;
    if (along < -Math.min(8, size / 4)) continue;
    const overlap = horizontal ? Math.min(from.bottom, r.bottom) - Math.max(from.top, r.top) : Math.min(from.right, r.right) - Math.max(from.left, r.left);
    const gap = Math.max(0, -overlap);
    const inLine = overlap > 0 ? 0 : 1;
    if ((inLineOnly || minor) && inLine) continue;
    const dist = Math.max(0, along) + (inLine ? gap * 2 : 0);
    // In line beats at an angle; then nearer; then more overlap.
    const key: [number, number, number] = [inLine, dist, -Math.max(0, overlap)];
    if (key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] - 0.5 || (Math.abs(key[1] - bestKey[1]) <= 0.5 && key[2] < bestKey[2])))) {
      bestKey = key;
      best = el;
    }
  }
  return best;
}

/** Last focused item per group, so going back into a row lands where you left it. */
const remembered = new WeakMap<Element, HTMLElement>();

function groupOf(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>('[data-nav-group]');
}

/** Every group around `el`, innermost first (a row inside the page area). */
function groupsOf(el: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let g = groupOf(el); g; g = g.parentElement ? groupOf(g.parentElement) : null) out.push(g);
  return out;
}

/**
 * Entering a group from outside: the outermost group entered decides (coming back from the sidebar
 * returns to the page item you left; moving down into a row returns to that row's item), using its
 * remembered item, else its current one (active page / category), else the geometric `target`.
 */
function entryPoint(target: HTMLElement, from: HTMLElement): HTMLElement {
  const entered = groupsOf(target).filter((g) => !g.contains(from));
  const group = entered[entered.length - 1];
  if (!group) return target;
  const last = remembered.get(group);
  if (last && last !== from && last.isConnected && group.contains(last) && visible(last)) return last;
  // A column entered for the first time starts on its main content ([data-autofocus]: the channel
  // list, the first match), not on a filter chip that happens to be marked current.
  const auto = group.dataset.navGroup === 'column' ? group.querySelector<HTMLElement>('[data-autofocus]') : null;
  const start = auto && startOf(auto, candidates());
  if (start) return start;
  const current = group.querySelector<HTMLElement>('[aria-current="page"], [aria-selected="true"], .active');
  if (current && visible(current) && current.matches(FOCUSABLE)) return current;
  return target;
}

function focus(el: HTMLElement, dir?: Dir): void {
  if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  const vertical = dir === 'up' || dir === 'down' || !dir;
  el.scrollIntoView({ block: vertical ? 'center' : 'nearest', inline: 'nearest', behavior: 'auto' });
  for (const g of groupsOf(el)) remembered.set(g, el);
}

function typing(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button', 'submit', 'color'].includes(el.type);
}

/** Left/Right in a text box move the cursor, unless it is already at that end of the text. */
function cursorCanMove(el: HTMLInputElement | HTMLTextAreaElement, dir: Dir): boolean {
  let start: number | null = null;
  let end: number | null = null;
  try {
    start = el.selectionStart;
    end = el.selectionEnd;
  } catch {
    return false; // input types without a cursor (number, email in some engines)
  }
  if (start === null || end === null) return false;
  if (start !== end) return true;
  return dir === 'left' ? start > 0 : end < el.value.length;
}

function column(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>('[data-nav-group="column"]');
}

/**
 * Left/Right: the area of the nearest thing that way (the next column), so the channel list beside
 * the categories wins over a button that happens to be level with you further across.
 */
function nearestArea(from: HTMLElement, dir: Dir, list: HTMLElement[]): HTMLElement[] {
  const f = from.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestAlong = Infinity;
  for (const el of list) {
    const r = el.getBoundingClientRect();
    const along = dir === 'right' ? r.left - f.right : f.left - r.right;
    // Wholly beyond the edge: a top-bar chip that starts just inside it isn't "the next column".
    if (along < -1) continue;
    if (along < bestAlong - 0.5) {
      bestAlong = along;
      best = el;
    }
  }
  if (!best) return list;
  const area = groupsOf(best).find((g) => !g.contains(from));
  return area ? list.filter((el) => area.contains(el)) : list;
}

/** The nearest ancestor that scrolls along the axis of `dir`. */
function scroller(el: HTMLElement, dir: Dir): HTMLElement | null {
  const vertical = dir === 'up' || dir === 'down';
  for (let p = el.parentElement; p; p = p.parentElement) {
    const st = getComputedStyle(p);
    const ov = vertical ? st.overflowY : st.overflowX;
    if (/(auto|scroll)/.test(ov) && (vertical ? p.scrollHeight > p.clientHeight + 4 : p.scrollWidth > p.clientWidth + 4)) return p;
  }
  return null;
}

/** Closes the top dialog or menu if there is one (Escape); returns whether it did. */
export function closeOverlay(): boolean {
  if (!document.querySelector('[role="dialog"], [role="menu"], .player-menu')) return false;
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  return true;
}

/** Where a [data-autofocus] area starts: itself, the first item matching its value, else its first item. */
function startOf(auto: HTMLElement, list: HTMLElement[]): HTMLElement | null {
  if (!visible(auto)) return null;
  if (list.includes(auto)) return auto;
  const want = auto.dataset.autofocus;
  let named: HTMLElement | undefined;
  try {
    named = want ? list.find((el) => auto.contains(el) && el.matches(want)) : undefined;
  } catch {
    named = undefined; // not a selector
  }
  return named ?? list.find((el) => auto.contains(el)) ?? null;
}

/** Focuses the page's first content item (not the sidebar or top bar): what a TV app starts on. */
export function focusFirstContent(): boolean {
  if (!installed) return false;
  const active = document.activeElement as HTMLElement | null;
  if (active && active !== document.body && document.contains(active) && visible(active) && !active.closest('.rail')) return false;
  const list = candidates();
  // A page can name its starting point ([data-autofocus]: the Live TV channel list), else the first
  // content item that isn't a text box (a search box would swallow Left/Right).
  const marked = document.querySelector<HTMLElement>('[data-autofocus]');
  const preferred = marked && startOf(marked, list);
  const content = (el: HTMLElement) => !!el.closest('.main') && !el.closest('.topbar');
  const first = preferred ?? list.find((el) => content(el) && !typing(el)) ?? list.find(content) ?? list[0];
  if (!first) return false;
  focus(first);
  return true;
}

function move(from: HTMLElement, dir: Dir, retry = 0, within?: HTMLElement): boolean {
  // After scrolling a list for more items, only that list's items count: everything else moved
  // relative to it (the sidebar would suddenly look "below").
  const all = (within ? candidates().filter((el) => within.contains(el)) : candidates()).filter((el) => el !== from && !el.contains(from) && !from.contains(el));
  const pick = (list: HTMLElement[], inLineOnly = false) =>
    nextInDirection(from.getBoundingClientRect(), dir, list.map((el) => ({ el, r: el.getBoundingClientRect(), minor: el.hasAttribute('data-nav-minor') })), inLineOnly);
  let next: HTMLElement | null;
  if (dir === 'up' || dir === 'down') {
    // Up/Down stay in the column you're in, else the area (the page, the sidebar): only Left/Right
    // cross over. Past the top of the page, things outside every area (the top bar) are next.
    const col = column(from);
    const region = col ?? groupsOf(from).at(-1);
    const inRegion = region ? all.filter((el) => region.contains(el)) : all;
    // Inside a scrolling list, the list's own items come first, even scrolled out of view: the match
    // above has slid under the header, where the header's chips would otherwise look nearer.
    const sc = scroller(from, dir);
    const inList = sc && sc !== document.scrollingElement ? pick(inRegion.filter((el) => sc.contains(el))) : null;
    next = inList ?? pick(inRegion) ?? (region ? pick(all.filter((el) => !groupOf(el))) : null);
  } else {
    const area = nearestArea(from, dir, all);
    // Within a column, Left/Right only move along the line you're on (no diagonal jump to a button
    // above); crossing into the next column may land at an angle.
    const col = column(from);
    const staying = !!col && area.every((el) => col.contains(el));
    next = pick(area, staying);
  }
  if (next) {
    focus(entryPoint(next, from), dir);
    return true;
  }
  // Nothing loaded that way (a virtual grid renders as you scroll): scroll on and look again.
  const sc = scroller(from, dir);
  if (!sc || retry > 0) return false;
  const before = dir === 'up' || dir === 'down' ? sc.scrollTop : sc.scrollLeft;
  const step = (dir === 'up' || dir === 'left' ? -1 : 1) * 0.6 * (dir === 'up' || dir === 'down' ? sc.clientHeight : sc.clientWidth);
  if (dir === 'up' || dir === 'down') sc.scrollTop += step;
  else sc.scrollLeft += step;
  const after = dir === 'up' || dir === 'down' ? sc.scrollTop : sc.scrollLeft;
  if (after === before) return false;
  requestAnimationFrame(() => requestAnimationFrame(() => move(from.isConnected ? from : sc, dir, retry + 1, sc)));
  return true;
}

let installed = false;

export function installSpatialNav(): void {
  if (installed) return;
  installed = true;
  document.documentElement.classList.add('tv-mode');
  // Remember the item focused in a group however it got focus (mouse, Tab, a dialog closing).
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t instanceof HTMLElement) for (const g of groupsOf(t)) remembered.set(g, t);
  });
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    // The full-screen web player has its own keys (seek, zap, volume).
    if (document.querySelector('.player-full')) return;
    const active = document.activeElement as HTMLElement | null;
    const dir = DIRS[e.key];
    if (dir) {
      // Move the text cursor, unless it's at that end of the text.
      if (typing(active) && (dir === 'left' || dir === 'right') && cursorCanMove(active as HTMLInputElement, dir)) return;
      const list = candidates();
      if (!list.length) return;
      const from = active && active !== document.body && list.includes(active) ? active : null;
      e.preventDefault();
      if (!from) {
        focusFirstContent() || focus(list[0]);
        return;
      }
      move(from, dir);
      return;
    }
    // OK on something that isn't natively clickable by keyboard (rows, cards with roles).
    if (e.key === 'Enter' && active && active !== document.body && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) {
      e.preventDefault();
      active.click();
    }
  });
}
