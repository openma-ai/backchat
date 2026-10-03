import {
  acpForkPointsFromMessages,
  type AcpForkPoint,
} from "@openma/common/acp-runtime";

import type { Turn } from "./session-types";

const SEGMENT_SUFFIX = /:segment:\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** ACP may wrap the update. The message id lives on the update itself. */
function sessionUpdate(payload: unknown): Record<string, unknown> | undefined {
  if (!isRecord(payload)) return undefined;
  if (typeof payload.sessionUpdate === "string") return payload;
  if (isRecord(payload.update) && typeof payload.update.sessionUpdate === "string") {
    return payload.update;
  }
  return undefined;
}

function collapseForkMessageId(messageId: string): string {
  return messageId.replace(SEGMENT_SUFFIX, "");
}

/** Nested subagent/sidechain text is not a top-level fork point. */
function isNestedAssistantUpdate(update: Record<string, unknown>): boolean {
  if (typeof update.parentToolUseId === "string" && update.parentToolUseId.trim()) {
    return true;
  }
  const meta = isRecord(update._meta) ? update._meta : undefined;
  if (!meta) return false;
  const claude = isRecord(meta.claudeCode) ? meta.claudeCode : undefined;
  if (typeof claude?.parentToolUseId === "string" && claude.parentToolUseId.trim()) {
    return true;
  }
  const codex = isRecord(meta.codex) ? meta.codex : undefined;
  if (!codex) return false;
  return codex.subagent != null || codex.collaboration != null;
}

function assistantText(update: Record<string, unknown>): string | undefined {
  if (update.sessionUpdate !== "agent_message_chunk") return undefined;
  const content = isRecord(update.content) ? update.content : undefined;
  if (!content || content.type !== "text" || typeof content.text !== "string") return undefined;
  if (!content.text) return undefined;
  return content.text;
}

interface MergedAssistantMessage {
  messageId: string;
  text: string;
}

function mergedMessagesForTurn(turn: Turn): MergedAssistantMessage[] {
  const messages: MergedAssistantMessage[] = [];
  const indexById = new Map<string, number>();
  for (const event of turn.events) {
    const update = sessionUpdate(event.payload);
    if (!update || isNestedAssistantUpdate(update)) continue;
    const text = assistantText(update);
    const rawId = typeof update.messageId === "string" ? update.messageId.trim() : "";
    if (!text || !rawId) continue;
    const messageId = collapseForkMessageId(rawId);
    if (!messageId) continue;
    const existing = indexById.get(messageId);
    if (existing === undefined) {
      indexById.set(messageId, messages.length);
      messages.push({ messageId, text });
    } else {
      messages[existing] = {
        messageId,
        text: messages[existing]!.text + text,
      };
    }
  }
  return messages;
}

function completedTurns(turns: readonly Turn[]): Turn[] {
  return turns
    .map((turn, index) => ({ turn, index }))
    .filter(({ turn }) => turn.status === "complete")
    .sort((a, b) => a.turn.startedAt - b.turn.startedAt || a.index - b.index)
    .map(({ turn }) => turn);
}

/** Top-level assistant messages in time order, with `:segment:N` ids merged. */
export function topLevelAssistantMessages(
  turns: readonly Turn[],
): Array<{ messageId: string; text: string }> {
  const merged: MergedAssistantMessage[] = [];
  const indexById = new Map<string, number>();
  for (const turn of completedTurns(turns)) {
    for (const message of mergedMessagesForTurn(turn)) {
      const existing = indexById.get(message.messageId);
      if (existing === undefined) {
        indexById.set(message.messageId, merged.length);
        merged.push({ ...message });
      } else {
        merged[existing] = {
          messageId: message.messageId,
          text: merged[existing]!.text + message.text,
        };
      }
    }
  }
  return merged;
}

export function forkPointsByTurn(
  turns: readonly Turn[],
): Map<string, AcpForkPoint> {
  const points = acpForkPointsFromMessages(topLevelAssistantMessages(turns));
  const byMessageId = new Map(points.map((point) => [point.messageId, point]));
  const byTurn = new Map<string, AcpForkPoint>();
  for (const turn of completedTurns(turns)) {
    const last = mergedMessagesForTurn(turn).at(-1);
    const point = last ? byMessageId.get(last.messageId) : undefined;
    if (point) byTurn.set(turn.id, point);
  }
  return byTurn;
}
