export interface BrowserFindTarget {
  findInPage(
    text: string,
    options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean },
  ): number;
  stopFindInPage(
    action: "clearSelection" | "keepSelection" | "activateSelection",
  ): void;
}

export interface BrowserFindShortcutTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export function applyBrowserFindQuery(
  target: BrowserFindTarget | null | undefined,
  query: string,
): void {
  const normalizedQuery = query.trim();
  if (normalizedQuery) {
    target?.findInPage(normalizedQuery);
  } else {
    target?.stopFindInPage("clearSelection");
  }
}

export function findNextInBrowser(
  target: BrowserFindTarget | null | undefined,
  query: string,
): void {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return;
  target?.findInPage(normalizedQuery, {
    forward: true,
    findNext: true,
  });
}

export function clearBrowserFind(
  target: BrowserFindTarget | null | undefined,
): void {
  target?.stopFindInPage("clearSelection");
}

export function bindBrowserFindShortcuts(
  target: BrowserFindShortcutTarget,
  options: {
    isOpen(): boolean;
    onOpen(): void;
    onClose(): void;
  },
): () => void {
  const onKeyDown: EventListener = (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (
      (keyboardEvent.metaKey || keyboardEvent.ctrlKey)
      && keyboardEvent.key.toLowerCase() === "f"
    ) {
      keyboardEvent.preventDefault();
      options.onOpen();
    } else if (keyboardEvent.key === "Escape" && options.isOpen()) {
      keyboardEvent.preventDefault();
      options.onClose();
    }
  };
  target.addEventListener("keydown", onKeyDown);
  return () => target.removeEventListener("keydown", onKeyDown);
}
