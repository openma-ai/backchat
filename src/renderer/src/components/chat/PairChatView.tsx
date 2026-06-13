/**
 * PairChatView — multi-agent grid chat.
 *
 * Each pair member is rendered as a column. The user types ONCE in
 * the bottom composer; the prompt fans out to every member via
 * pairPrompt. Each column reuses the existing TurnBlock renderer to
 * stream that member's events independently.
 *
 * The grid scales:
 *   - 2 members → 2 columns side-by-side
 *   - 3-4 members → 2x2 grid (third / fourth row wrap)
 *
 * Composer locks while any member is still streaming the current
 * turn — keyed off `PairRow.activeTurnId` which only clears once
 * every member completes.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { SendIcon } from "lucide-react";
import { TurnBlock, MarkdownCwdProvider } from "./ChatView";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  sessionStore,
  useSessionStore,
  selectTurnsFor,
  type SessionRow,
  type PairRow,
} from "@/lib/session-store";

export function PairChatView() {
  const params = useParams({ strict: false }) as { pairId?: string };
  const pair = useSessionStore((s) => (params.pairId ? s.pair(params.pairId) : null));
  const members = useSessionStore(
    useMemo(
      () => (st: ReturnType<typeof useSessionStore<unknown>> extends never ? never : any) => {
        if (!pair) return [] as SessionRow[];
        return pair.members
          .map((sid) => st.get(sid))
          .filter((s: SessionRow | null): s is SessionRow => !!s);
      },
      [pair?.id, pair?.members.join("|")],
    ),
  );

  if (!pair) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-fg-muted">
        Pair not found.
      </div>
    );
  }

  const columnCount = pair.members.length;
  // 2 → two cols. 3-4 → 2x2 grid. Above 4 isn't supported by the
  // picker, but if a pair somehow has more, falls through to a wider
  // grid that wraps.
  const gridClass =
    columnCount <= 2
      ? "grid-cols-2"
      : columnCount <= 4
        ? "grid-cols-2 grid-rows-2"
        : "grid-cols-3";

  return (
    <div className="flex h-full flex-col">
      <div className={cn("grid flex-1 min-h-0 gap-2 p-2", gridClass)}>
        {members.map((m) => (
          <PairColumn key={m.id} session={m} />
        ))}
        {members.length === 0 && (
          <div className="col-span-full flex items-center justify-center text-sm text-fg-muted">
            Starting pair members…
          </div>
        )}
      </div>
      <PairComposer pair={pair} />
    </div>
  );
}

/** One column of the pair grid — heading + scrollable transcript for
 *  a single member session. Reuses TurnBlock so streaming, tool rows,
 *  image hoist, etc. all work identically to single-chat. */
function PairColumn({ session }: { session: SessionRow }) {
  const turns = useSessionStore(
    useMemo(() => selectTurnsFor(session.id), [session.id]),
  );

  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-border/60 bg-bg/40">
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5 text-xs">
        <span className="font-medium text-fg">{session.agent_id}</span>
        <span className="text-fg-subtle">·</span>
        <span className={cn(
          "text-fg-subtle",
          session.status === "running" && "text-fg-muted",
          session.status === "errored" && "text-danger",
        )}>
          {session.status}
        </span>
      </div>
      <MarkdownCwdProvider cwd={session.cwd}>
        <StickToBottom className="min-h-0 flex-1 px-3 py-2" initial="smooth">
          <StickToBottom.Content className="space-y-3">
            {turns.length === 0 && session.status !== "running" && (
              <p className="text-[12px] text-fg-subtle">尚无消息</p>
            )}
            {turns.map((t) => (
              <TurnBlock key={t.id} turn={t} />
            ))}
          </StickToBottom.Content>
        </StickToBottom>
      </MarkdownCwdProvider>
    </div>
  );
}

/** Shared composer that fans out a prompt to every member of a pair.
 *  Locked while any member is still streaming the current turn. */
function PairComposer({ pair }: { pair: PairRow }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const locked = !!pair.activeTurnId;

  const submit = async () => {
    const t = text.trim();
    if (!t || locked) return;
    setText("");
    // Members that are still draft need to spawn first. Fire startPair
    // (idempotent — backend no-ops if pair is already alive) before
    // promptPair so the first user prompt always lands on running
    // ACP children.
    const members = pair.members
      .map((sid) => sessionStore.get(sid))
      .filter((s): s is SessionRow => !!s);
    const anyDraft = members.some((m) => m.status === "draft");
    if (anyDraft) {
      // Promote draft members so their status flips to "starting"
      // (matches single-chat path).
      for (const m of members) {
        if (m.status === "draft") {
          sessionStore.promoteDraft(m.id, m.agent_id, m.label);
        }
      }
      await window.backchat.pairStart({
        pair_id: pair.id,
        members: members.map((m) => ({
          session_id: m.id,
          agent_id: m.agent_id,
        })),
      });
    }
    const turn_id = sessionStore.registerPairTurn(pair.id, t);
    if (!turn_id) return;
    await window.backchat.pairPrompt({ pair_id: pair.id, turn_id, text: t });
  };

  return (
    <div className="border-t border-border/40 bg-bg-surface/40 p-3">
      <div className="flex items-end gap-2">
        <Textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={
            locked ? "等所有 agent 完成…" : `同时发送给 ${pair.members.length} 个 agent…`
          }
          disabled={locked}
          rows={2}
          className="flex-1 resize-none"
        />
        <Button
          type="button"
          size="icon"
          onClick={() => void submit()}
          disabled={locked || !text.trim()}
        >
          <SendIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// Wire useStickToBottomContext to avoid the unused import warning —
// the StickToBottom component owns its own context internally, we
// don't need to read it at this level.
void useStickToBottomContext;
