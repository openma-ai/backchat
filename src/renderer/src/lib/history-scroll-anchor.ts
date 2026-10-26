/** Keep the first visible turn at the same viewport offset across a prepend. */
export interface HistoryScrollAnchor {
  turnId?: string;
  element?: HTMLElement;
  text?: string;
  offset: number;
  height: number;
  top: number;
}

export function captureHistoryAnchor(scroller: HTMLElement): HistoryScrollAnchor {
  const viewport = scroller.getBoundingClientRect();
  const row = Array.from(scroller.querySelectorAll<HTMLElement>('[data-turn-id]'))
    .find(element => {
      const box = element.getBoundingClientRect();
      return box.bottom > viewport.top && box.top < viewport.bottom;
    });
  const element = row && (Array.from(row.querySelectorAll<HTMLElement>('p, pre, li, h1, h2, h3, img, [data-session-turn-prompt]'))
    .find(candidate => {
      const box = candidate.getBoundingClientRect();
      return box.bottom > viewport.top && box.top < viewport.bottom;
    }) ?? row);
  return {
    turnId: row?.dataset.turnId,
    element,
    text: element?.textContent ?? undefined,
    offset: element ? element.getBoundingClientRect().top - viewport.top : 0,
    height: scroller.scrollHeight,
    top: scroller.scrollTop,
  };
}

export function restoreHistoryAnchor(scroller: HTMLElement, anchor: HistoryScrollAnchor): void {
  const row = anchor.turnId
    ? Array.from(scroller.querySelectorAll<HTMLElement>('[data-turn-id]'))
      .find(element => element.dataset.turnId === anchor.turnId)
    : undefined;
  const element = anchor.element && scroller.contains(anchor.element)
    ? anchor.element
    : (Array.from((row ?? scroller).querySelectorAll<HTMLElement>('p, pre, li, h1, h2, h3, img, [data-session-turn-prompt]'))
      .find(candidate => candidate.textContent === anchor.text) ?? row);
  scroller.scrollTop = Math.max(0, element
    ? scroller.scrollTop + element.getBoundingClientRect().top
      - scroller.getBoundingClientRect().top - anchor.offset
    : anchor.top + scroller.scrollHeight - anchor.height);
}
