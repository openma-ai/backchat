/** When a sidebar row's hover card should open — the intent, not the paint.
 *
 *  Opening on pointer-enter makes the card a by-product of travel: sweeping
 *  down the list, reaching for a row's ⋯, or scrolling rows under a still
 *  pointer all raised cards nobody asked for. The card answers "what is this
 *  row?", so it waits until the pointer has come to rest on one row.
 *
 *  - Rest, not enter: every real movement restarts the clock.
 *  - Scroll is not movement: Chromium re-sends pointer events at unchanged
 *    coordinates while content scrolls beneath; those are ignored until the
 *    pointer itself moves.
 *  - A press (click, right-click) is the user acting on the row; the card
 *    stays away until the pointer leaves that row.
 *  - The row's action buttons are not part of the trigger (key: null).
 *  - Right after a card was showing, a neighbour opens after a short rest —
 *    reading down the list does not pay the full delay each time.
 *  - Mouse only: touch and pen have no hover. */

export const HOVER_INTENT_REST_MS = 700;
export const HOVER_INTENT_WARM_MS = 150;
export const HOVER_INTENT_WARM_WINDOW_MS = 600;

export type HoverIntentMove = {
  /** The hovered row's card key, or null over actions / non-card rows. */
  key: string | null;
  x: number;
  y: number;
  mouse: boolean;
};

export type HoverIntent = {
  move(event: HoverIntentMove): void;
  press(): void;
  scroll(): void;
  leave(): void;
  dispose(): void;
};

export function createHoverIntent(options: {
  onChange: (key: string | null) => void;
  /** True while something else owns the pointer (an open menu). */
  blocked?: () => boolean;
}): HoverIntent {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let candidate: string | null = null;
  let openKey: string | null = null;
  let suppressed: string | null = null;
  let lastX = Number.NaN;
  let lastY = Number.NaN;
  let scrolledSinceMove = false;
  let lastClosedAt = Number.NEGATIVE_INFINITY;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const close = () => {
    clearTimer();
    if (openKey === null) return;
    openKey = null;
    lastClosedAt = Date.now();
    options.onChange(null);
  };
  const arm = (key: string) => {
    clearTimer();
    const warm = Date.now() - lastClosedAt <= HOVER_INTENT_WARM_WINDOW_MS;
    timer = setTimeout(() => {
      timer = undefined;
      if (candidate !== key || suppressed === key) return;
      if (options.blocked?.()) return;
      openKey = key;
      options.onChange(key);
    }, warm ? HOVER_INTENT_WARM_MS : HOVER_INTENT_REST_MS);
  };

  return {
    move({ key, x, y, mouse }) {
      if (!mouse) return;
      const still = x === lastX && y === lastY;
      if (still && (scrolledSinceMove || key === candidate)) return;
      lastX = x;
      lastY = y;
      scrolledSinceMove = false;
      if (key !== candidate) {
        if (suppressed !== null && suppressed !== key) suppressed = null;
        candidate = key;
        if (openKey !== null && openKey !== key) close();
      }
      if (key === null) {
        clearTimer();
        return;
      }
      if (suppressed === key || openKey === key) return;
      arm(key);
    },
    press() {
      clearTimer();
      suppressed = candidate;
      close();
    },
    scroll() {
      clearTimer();
      scrolledSinceMove = true;
      close();
    },
    leave() {
      clearTimer();
      candidate = null;
      suppressed = null;
      close();
    },
    dispose() {
      clearTimer();
    },
  };
}
