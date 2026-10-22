/** xterm text metrics. The family comes from the mono token. Line height
 *  stays at the previous 1.25; box-drawing metrics are not part of this change. */
export function terminalTextOptions(fontFamily: string): {
  fontFamily: string;
  fontWeight: 400;
  fontSize: 12;
  lineHeight: 1.25;
} {
  return {
    fontFamily,
    fontWeight: 400,
    fontSize: 12,
    lineHeight: 1.25,
  };
}
