import { createHash } from "node:crypto";
import type { OpenmaScope } from "../shared/openma.js";

export function openmaScopeKey(scope: OpenmaScope): string {
  return JSON.stringify([scope.baseUrl, scope.userId, scope.workspaceId]);
}

export function openmaDesktopTaskId(scope: OpenmaScope, remoteId: string): string {
  return `openma-${createHash("sha256").update(JSON.stringify([openmaScopeKey(scope), remoteId])).digest("hex").slice(0, 32)}`;
}

/** Execution and observation are separate local records for one remote task. */
export function openmaRunnerSessionId(scope: OpenmaScope, remoteId: string): string {
  return `runner-${openmaDesktopTaskId(scope, remoteId)}`;
}
