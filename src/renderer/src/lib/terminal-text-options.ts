/** xterm text metrics. `lineHeight` above 1 leaves a gap between
 *  box-drawing rows. `customGlyphs` draws those rules to the cell edge
 *  on the canvas and WebGL renderers. */
export function terminalTextOptions(fontFamily: string): {
  fontFamily: string;
  fontWeight: 400;
  fontSize: 12;
  lineHeight: 1;
  customGlyphs: true;
} {
  return {
    fontFamily,
    fontWeight: 400,
    fontSize: 12,
    lineHeight: 1,
    customGlyphs: true,
  };
}
