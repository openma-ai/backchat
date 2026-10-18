import { useEffect, useRef, useState, type RefObject } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useI18n } from "@/lib/i18n";
import { homeRelative, RepositoryCardBody } from "./RepositoryHoverCard";
import { createHoverIntent } from "./sidebar-hover-intent";

/** What a hovered row is, for the one card the sidebar shows. */
export type SidebarCardSpec =
  | { kind: "repository"; title: string; paths: string[] }
  | { kind: "session"; title: string; agent?: string; cwd?: string; error?: string }
  | { kind: "pair"; title: string; members: string[] };

/** Rows opt in with data-sidebar-card="<key>". Their trailing actions do not
 *  count: reaching for ⋯ is not asking what the row is. */
function cardTarget(target: EventTarget | null): { key: string | null; row: HTMLElement | null } {
  if (!(target instanceof Element)) return { key: null, row: null };
  const row = target.closest<HTMLElement>("[data-sidebar-card]");
  if (!row || target.closest('[data-sidebar-grid="trailing"]')) return { key: null, row: null };
  return { key: row.dataset.sidebarCard ?? null, row };
}

const menuIsOpen = () =>
  document.querySelector('[data-slot="dropdown-menu-content"], [data-slot="context-menu-content"]') !== null;

/** One hover card for the whole sidebar, driven by delegated pointer events
 *  and the intent rules in sidebar-hover-intent.ts. Every row kind gets the
 *  same timing and placement; the card itself is read-only (actions live in
 *  the row menu), so it never takes the pointer and closes when the pointer
 *  leaves the row. */
export function SidebarHoverCard({
  rootRef,
  resolve,
  onCandidate,
}: {
  rootRef: RefObject<HTMLElement | null>;
  resolve: (key: string) => SidebarCardSpec | null;
  /** The pointer has started to settle on a row: warm whatever the card reads. */
  onCandidate?: (key: string) => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const rowRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef({ getBoundingClientRect: () => rowRef.current?.getBoundingClientRect() ?? new DOMRect() });
  const onCandidateRef = useRef(onCandidate);
  onCandidateRef.current = onCandidate;
  const intentRef = useRef<ReturnType<typeof createHoverIntent> | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const intent = createHoverIntent({ onChange: setOpenKey, blocked: menuIsOpen });
    intentRef.current = intent;
    let lastCandidate: string | null = null;
    const onMove = (event: PointerEvent) => {
      const { key, row } = cardTarget(event.target);
      if (row && key) rowRef.current = row;
      if (key && key !== lastCandidate) onCandidateRef.current?.(key);
      lastCandidate = key;
      intent.move({ key, x: event.clientX, y: event.clientY, mouse: event.pointerType === "mouse" });
    };
    const onPress = () => intent.press();
    const onLeave = () => { lastCandidate = null; intent.leave(); };
    const onScroll = () => intent.scroll();
    root.addEventListener("pointermove", onMove, { passive: true });
    root.addEventListener("pointerdown", onPress, { passive: true });
    root.addEventListener("contextmenu", onPress, { passive: true });
    root.addEventListener("pointerleave", onLeave, { passive: true });
    root.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("blur", onLeave);
    return () => {
      intent.dispose();
      intentRef.current = null;
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerdown", onPress);
      root.removeEventListener("contextmenu", onPress);
      root.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("blur", onLeave);
    };
  }, [rootRef]);

  const spec = openKey ? resolve(openKey) : null;
  return (
    <Popover open={spec !== null} onOpenChange={(open) => { if (!open) intentRef.current?.leave(); }}>
      <PopoverAnchor virtualRef={anchorRef} />
      {spec && (
        <PopoverContent
          role="tooltip"
          side="right"
          align="start"
          sideOffset={10}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className="sidebar-row-card pointer-events-none w-72 gap-0 p-1.5 text-caption"
          data-sidebar-row-card={spec.kind}
        >
          <SidebarCardBody spec={spec} />
        </PopoverContent>
      )}
    </Popover>
  );
}

function SidebarCardBody({ spec }: { spec: SidebarCardSpec }) {
  const { t } = useI18n();
  if (spec.kind === "repository") {
    return <>
      <p className="truncate px-1.5 pb-1 pt-0.5 text-ui font-medium text-fg">{spec.title}</p>
      <RepositoryCardBody paths={spec.paths} />
    </>;
  }
  if (spec.kind === "pair") {
    return <>
      <p className="line-clamp-3 px-1.5 pb-1 pt-0.5 text-ui font-medium text-fg">{spec.title || t("sidebar.pairChat")}</p>
      {spec.members.length > 0 && <p className="truncate px-1.5 py-0.5 text-fg-faint">{spec.members.join(" · ")}</p>}
    </>;
  }
  const meta = [spec.agent, spec.cwd ? homeRelative(spec.cwd) : undefined].filter(Boolean);
  return <>
    <p className="line-clamp-3 px-1.5 pb-1 pt-0.5 text-ui font-medium text-fg">{spec.title}</p>
    {meta.length > 0 && <p className="truncate px-1.5 py-0.5 text-fg-faint">{meta.join(" · ")}</p>}
    {spec.error && <p className="line-clamp-3 px-1.5 py-0.5 text-danger">{spec.error}</p>}
  </>;
}
