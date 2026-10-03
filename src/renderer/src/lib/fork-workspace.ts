import { isPerSessionFolderPath } from "./project-path";

/** A chat owns a managed per-session folder when it never picked a project.
 *  Restored rows may lack `projectScope`; a `sessions/sess-*` or
 *  `sessions/fork-*` directory is still that private folder. */
export function sessionUsesManagedWorkspace(session: {
  projectScope?: "none" | "project";
  projectId?: string;
  cwd?: string;
  chosenCwd?: string;
}): boolean {
  if (session.projectScope === "none") return true;
  if (session.projectScope === "project" || session.projectId?.trim()) return false;
  const cwd = (session.chosenCwd || session.cwd || "").trim();
  return !cwd || isPerSessionFolderPath(cwd);
}
