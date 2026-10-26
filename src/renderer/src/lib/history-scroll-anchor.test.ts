// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { captureHistoryAnchor, restoreHistoryAnchor } from './history-scroll-anchor';

function fixture() {
  const scroller = document.createElement('div');
  scroller.scrollTop = 100;
  Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true });
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: 400 }) as DOMRect;
  const row = document.createElement('div');
  row.dataset.turnId = 'visible';
  row.getBoundingClientRect = () => ({ top: -20, bottom: 180 }) as DOMRect;
  scroller.append(row);
  return { scroller, row };
}

describe('history viewport anchor', () => {
  it('preserves the visible message rather than unrelated total-height changes', () => {
    const {scroller,row} = fixture();
    const anchor = captureHistoryAnchor(scroller);
    row.getBoundingClientRect = () => ({top: 280, bottom: 480}) as DOMRect;
    Object.defineProperty(scroller, 'scrollHeight', {value: 1700});
    restoreHistoryAnchor(scroller, anchor);
    expect(scroller.scrollTop).toBe(400);
  });
  it('anchors a visible paragraph when earlier content grows inside the same turn', () => {
    const {scroller,row} = fixture();
    const paragraph = document.createElement('p');
    paragraph.textContent = 'Currently reading';
    paragraph.getBoundingClientRect = () => ({top: 30,bottom:80}) as DOMRect;
    row.append(paragraph);
    const anchor = captureHistoryAnchor(scroller);
    paragraph.getBoundingClientRect = () => ({top:330,bottom:380}) as DOMRect;
    restoreHistoryAnchor(scroller,anchor);
    expect(scroller.scrollTop).toBe(400);
  });
  it('finds a remounted virtual row by its stable turn identity', () => {
    const {scroller,row} = fixture();
    const anchor = captureHistoryAnchor(scroller);
    const replacement = row.cloneNode() as HTMLElement;
    replacement.getBoundingClientRect = () => ({top: 80,bottom:280}) as DOMRect;
    row.replaceWith(replacement);
    restoreHistoryAnchor(scroller, anchor);
    expect(scroller.scrollTop).toBe(200);
  });
  it('falls back to height delta only when the anchored row is absent', () => {
    const {scroller,row} = fixture();
    const anchor = captureHistoryAnchor(scroller);
    row.remove();
    Object.defineProperty(scroller, 'scrollHeight', {value: 1300});
    restoreHistoryAnchor(scroller, anchor);
    expect(scroller.scrollTop).toBe(400);
  });
});
