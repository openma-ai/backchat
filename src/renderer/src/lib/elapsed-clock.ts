/** Human elapsed time for a progress row. The reference client shows
 * "23m 34s", so seconds alone stop being readable within a minute. */
export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Seconds a row should show: whatever the agent reported, else the wall clock
 * since it started. An adapter that never charges worked time reports 0, which
 * is why a half-hour goal read "0s". */
export function elapsedSecondsFor(
  reported: number | undefined,
  since: number | undefined,
  now: number,
): number | undefined {
  if (reported !== undefined && reported > 0) return reported;
  if (since === undefined) return reported;
  return Math.max(0, (now - since) / 1000);
}
