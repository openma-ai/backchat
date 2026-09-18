/** Route a paste that lands outside any editable element to a composer.
 *
 *  Cmd+V after clicking into the transcript, the sidebar, or a tool card
 *  reaches `document`, not the textarea. Without this the paste does
 *  nothing and the user assumes image paste is broken. The paste goes to
 *  the composer that last had focus; a composer that never had it (a side
 *  chat that just mounted) is only a fallback. */

export interface PasteRouterEvent {
  target: unknown;
  defaultPrevented: boolean;
  clipboardData: unknown;
  preventDefault(): void;
}

export interface PasteRouterDocument {
  addEventListener(type: "paste", listener: (event: PasteRouterEvent) => void): void;
  removeEventListener(type: "paste", listener: (event: PasteRouterEvent) => void): void;
}

export type PasteRouterHandler = (clipboardData: unknown, event: PasteRouterEvent) => void;

export interface PasteRouterRegistration {
  /** Call when the composer's textarea gains focus. */
  noteFocus(): void;
  unregister(): void;
}

interface EditableTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

/** Form fields and contenteditable hosts own their own paste. */
export function isEditableEventTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const { tagName, isContentEditable } = target as EditableTargetLike;
  if (isContentEditable) return true;
  const tag = tagName?.toUpperCase();
  return tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT";
}

export function createComposerPasteRouter(document: PasteRouterDocument | null | undefined) {
  const handlers: PasteRouterHandler[] = [];
  let focused: PasteRouterHandler | null = null;

  const onPaste = (event: PasteRouterEvent) => {
    if (event.defaultPrevented || !event.clipboardData) return;
    if (isEditableEventTarget(event.target)) return;
    const handler = focused ?? handlers.at(-1);
    handler?.(event.clipboardData, event);
  };

  return {
    register(handler: PasteRouterHandler): PasteRouterRegistration {
      if (handlers.length === 0) document?.addEventListener("paste", onPaste);
      handlers.push(handler);
      return {
        noteFocus: () => {
          focused = handler;
        },
        unregister: () => {
          const index = handlers.indexOf(handler);
          if (index >= 0) handlers.splice(index, 1);
          if (focused === handler) focused = null;
          if (handlers.length === 0) document?.removeEventListener("paste", onPaste);
        },
      };
    },
  };
}

export const composerPasteRouter = createComposerPasteRouter(
  typeof document === "undefined" ? null : document,
);
