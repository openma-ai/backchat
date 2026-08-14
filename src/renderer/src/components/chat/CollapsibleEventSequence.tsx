import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";

import { DisclosureChevron } from "@/components/ui/disclosure-chevron";
import { preserveScrollAnchor } from "@/lib/utils";
import { FadeScrollViewport } from "./FadeScrollViewport";

export interface CollapsibleEventNode {
  key: string;
  projection: {
    leading?: ReactNode;
    summary: ReactNode;
  };
  content: ReactNode;
}

/**
 * A secondary disclosure for one uninterrupted sequence of collapsible events.
 * Its header is always the projection of the sequence's latest event.
 */
export function CollapsibleEventSequence({
  nodes,
  active,
  completedProjection,
}: {
  nodes: CollapsibleEventNode[];
  active: boolean;
  completedProjection: CollapsibleEventNode["projection"];
}) {
  if (nodes.length === 1) return nodes[0]?.content ?? null;
  return (
    <CollapsibleEventSequenceGroup
      nodes={nodes}
      active={active}
      completedProjection={completedProjection}
    />
  );
}

function CollapsibleEventSequenceGroup({
  nodes,
  active,
  completedProjection,
}: {
  nodes: CollapsibleEventNode[];
  active: boolean;
  completedProjection: CollapsibleEventNode["projection"];
}) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const stick = useStickToBottomContext();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const open = manualOpen ?? active;
  const projected = active ? nodes.at(-1)?.projection : completedProjection;
  if (!projected) return null;

  const toggleOpen = () => {
    preserveScrollAnchor({
      scrollElement: stick.scrollRef.current,
      anchorElement: triggerRef.current,
      contentElement: stick.contentRef.current,
      update: () => setManualOpen((value) => !(value ?? active)),
      stopScroll: stick.stopScroll,
    });
  };

  return (
    <div className="py-0.5" data-collapsible-event-count={nodes.length}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onClick={toggleOpen}
        className="activity-disclosure-row min-h-6 text-[13px]"
      >
        {projected.leading && (
          <span className="grid size-[var(--chat-activity-icon-size)] shrink-0 place-items-center">
            {projected.leading}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-fg-muted">
          {projected.summary}
        </span>
        <DisclosureChevron open={open} />
      </button>
      {open && (
        <div className="ml-4 mt-1 border-l border-border/40 pl-2">
          <FadeScrollViewport level="secondary" contentClassName="space-y-1">
            {nodes.map((node) => (
              <div key={node.key}>{node.content}</div>
            ))}
          </FadeScrollViewport>
        </div>
      )}
    </div>
  );
}
