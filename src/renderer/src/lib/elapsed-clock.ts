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

/** A reported token budget as a compact "used / budget" string.
 *
 * The agent reports both numbers for a goal and neither was ever shown, so a
 * goal with a budget looked identical to one without: there was no way to tell
 * whether it was near its limit. A budget of zero or less is not a budget, and
 * usage alone is a number without a scale, so both cases stay silent rather
 * than render half a fraction.
 */
export function formatTokenBudget(
  tokensUsed: number | null | undefined,
  tokenBudget: number | null | undefined,
): string | null {
  if (typeof tokenBudget !== "number" || !Number.isFinite(tokenBudget)) {
    return null;
  }
  if (tokenBudget <= 0) return null;
  const used =
    typeof tokensUsed === "number" && Number.isFinite(tokensUsed) && tokensUsed > 0
      ? tokensUsed
      : 0;
  return `${compactTokens(used)}/${compactTokens(tokenBudget)}`;
}

function compactTokens(value: number): string {
  const rounded = Math.round(value);
  if (rounded < 1000) return String(rounded);
  const thousands = rounded / 1000;
  return thousands < 10
    ? `${thousands.toFixed(1).replace(/\.0$/u, "")}k`
    : `${Math.round(thousands)}k`;
}
