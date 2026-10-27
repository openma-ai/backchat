import { cn } from "@/lib/utils";

/**
 * A real progress bar.
 *
 * Only surfaces that know an exact percentage may use this — the App update
 * download reports one from `download-progress`. A managed-agent npm upgrade
 * has no measurable length, so it keeps a spinner instead of faking a bar.
 *
 * The fill is achromatic on purpose: coral is reserved for the one primary
 * action in a view, and a download in flight is not that.
 */
export function UpdateProgressBar({
  percent,
  label,
  className,
}: {
  percent: number;
  /** Accessible name for the bar — e.g. "Downloading update, 42%". */
  label: string;
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      data-update-progress="true"
      className={cn("h-1 w-full overflow-hidden rounded-full bg-fg/10", className)}
    >
      <div
        data-update-progress-fill="true"
        className="h-full rounded-full bg-fg/55 transition-[width] duration-200 ease-out"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
