/** Rectangles are physical pixels; the panel is 300 CSS px plus 12px clearance. */
export function resourcePanelFitsGutter(viewportRight: number, contentRight: number, scale: number): boolean {
  return viewportRight - contentRight >= 312 * scale;
}
