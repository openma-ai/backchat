/** macOS resting text asks for weight 400 so PingFang, including the
 *  raw family used when local() names miss, stays Regular. Variable Latin
 *  (SF) would otherwise draw that 400. Codex resting UI is 430. The axis
 *  is written on each element from its computed weight. It is not inherited,
 *  and it does not depend on a list of bold selectors: 400 becomes 430,
 *  and every other weight is left on font-weight. */

const MARK = "data-mac-latin";

/** Variation value for one computed font-weight. "normal" lets the
 *  element's own font-weight drive the wght axis. */
export function macLatinVariation(fontWeight: string): string {
  return Number.parseFloat(fontWeight) === 400 ? '"wght" 430' : "normal";
}

export function syncMacLatinAxis(root: ParentNode): void {
  const elements: Element[] = root instanceof Element ? [root] : [];
  for (const element of root.querySelectorAll("*")) elements.push(element);
  for (const element of elements) {
    if (!(element instanceof HTMLElement)) continue;
    const next = macLatinVariation(getComputedStyle(element).fontWeight);
    if (element.getAttribute(MARK) === next) continue;
    element.setAttribute(MARK, next);
    element.style.fontVariationSettings = next;
  }
}

/** Watch the document so a later weight change or a new node is updated.
 *  Returns a noop when this document is not macOS or cannot be observed. */
export function installMacLatinAxis(doc: Document): () => void {
  const root = doc.documentElement;
  if (!root || root.dataset.os !== "mac") return () => undefined;
  if (typeof doc.querySelectorAll !== "function") return () => undefined;
  syncMacLatinAxis(doc);
  const Observer = doc.defaultView?.MutationObserver;
  if (typeof Observer !== "function") return () => undefined;
  const observer = new Observer(() => {
    syncMacLatinAxis(doc);
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  return () => observer.disconnect();
}
