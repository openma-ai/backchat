import { backchatStorageRoot } from "../shared/control-socket.js";

/** Root shared by Backchat and OMA. BACKCHAT_HOME remains test-only so E2E
 * processes cannot read or mutate the developer's real local state. */
export function openmaRoot(): string {
  return backchatStorageRoot();
}
