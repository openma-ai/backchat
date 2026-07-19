import type { PromptAttachment } from "@shared/session-events.js";

export function attachmentExtensionLabel(name: string): string {
  const extension = name.split(".").pop();
  if (!extension || extension === name) return "FILE";
  return extension.slice(0, 4);
}

export function mergeComposerAttachments(
  current: PromptAttachment[],
  incoming: PromptAttachment[],
): PromptAttachment[] {
  const byPathOrId = new Map<string, PromptAttachment>();
  for (const attachment of current) {
    byPathOrId.set(attachment.path || attachment.id, attachment);
  }
  for (const attachment of incoming) {
    byPathOrId.set(attachment.path || attachment.id, attachment);
  }
  return [...byPathOrId.values()].slice(0, 10);
}
