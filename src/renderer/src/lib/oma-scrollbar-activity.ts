/** Mirrors @openma/common chat-ui scroll-reveal timing for every oma surface. */
export const OMA_SCROLLBAR_IDLE_MS = 450;

export function isOmaScrollbarElement(element: HTMLElement): boolean {
  return (
    element.classList.contains("oma-scrollbar")
    || element.classList.contains("chat-scrollbar")
    || element.getAttribute("data-slot") === "scroll-area-viewport"
  );
}

export function markOmaScrollbarScrolling(element: HTMLElement): void {
  element.dataset.chatScrolling = "true";
}

export function clearOmaScrollbarScrolling(element: HTMLElement): void {
  delete element.dataset.chatScrolling;
}
