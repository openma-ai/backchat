export type EnvironmentErrorKind = "diskFull";

/** Classify an error that comes from the user's machine rather than from the
 *  turn itself. Such errors repeat on every retry until the environment is
 *  fixed, so the UI surfaces them as a standing notice above the composer. */
export function environmentErrorKind(message: string | null | undefined): EnvironmentErrorKind | null {
  if (!message) return null;
  if (/\bENOSPC\b|no space left on device/i.test(message)) return "diskFull";
  return null;
}
