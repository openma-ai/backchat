import { useLayoutEffect, useRef } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";

/**
 * FollowOnSend — when a new turn lands at the tail (the user just sent),
 * bring it into view and re-arm stick-to-bottom so the streaming answer is
 * followed. Re-arming clears use-stick-to-bottom's "escaped" lock; from then
 * on its own resize observer keeps following until the user scrolls away.
 *
 * Must render INSIDE <Conversation> (reads useStickToBottomContext()).
 * The first render is skipped: opening a session is HistoryPager's job, and
 * prepending older history never changes the tail id.
 */
export function FollowOnSend({ tailTurnId }: { tailTurnId: string | undefined }) {
  const stick = useStickToBottomContext();
  const previous = useRef<string | undefined | null>(null);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = tailTurnId;
    if (before === null || !tailTurnId || before === tailTurnId) return;
    void stick.scrollToBottom({ animation: "smooth" });
  }, [tailTurnId, stick]);

  return null;
}
