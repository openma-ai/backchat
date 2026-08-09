/** Human elapsed time for a progress row. The reference client shows
 * "23m 34s", so seconds alone stop being readable within a minute. */
export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Seconds a row should show. A known start time wins, because it is the only
 * source that can still be moving a second from now — the reference client's
 * "23m 34s" is time since the goal was set. A reported total is used only when
 * there is no start time, and an adapter that charges no worked time reports 0,
 * which is why a half-hour goal read "0s". */
export function elapsedSecondsFor(
  reported: number | undefined,
  since: number | undefined,
  now: number,
): number | undefined {
  if (since !== undefined) return Math.max(0, (now - since) / 1000);
  return reported;
}
