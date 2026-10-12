/** Bottom-align an open submenu panel with its parent dropdown content. */
export function measureSubmenuBottomAlignOffset(): number {
  const trigger = document.querySelector(
    '[data-slot="dropdown-menu-sub-trigger"][data-state="open"]',
  );
  const parentMenu = trigger?.closest('[data-slot="dropdown-menu-content"]');
  if (!(trigger instanceof HTMLElement) || !(parentMenu instanceof HTMLElement)) {
    return 0;
  }
  return (
    trigger.getBoundingClientRect().bottom -
    parentMenu.getBoundingClientRect().bottom
  );
}
