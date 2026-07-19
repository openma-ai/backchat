import {
  BrainIcon,
  ChevronRightIcon,
  FileEditIcon,
  FileTextIcon,
  FolderTreeIcon,
  GlobeIcon,
  SearchIcon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react";
import {
  Suspense,
  lazy,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { safeJson } from "@/lib/format";
import {
  pickToolActivityTarget,
  pickToolActivityVerb,
  shortToolPath as shortPath,
} from "@/lib/chat-tool-presentation";
import { CHAT_GENERATED_IMAGE_CLASS } from "@/lib/chat-layout";
import type { ToolContentBlock, ToolEntry } from "@/lib/reduce-turn";
import type { SubagentActivity } from "@/lib/session-store";
import { resolveToolImageSource } from "@/lib/tool-content-source";
import { cn } from "@/lib/utils";
import { SubagentAvatar } from "@/components/SubagentAvatar";

const McpAppView = lazy(async () => {
  const module = await import("./McpAppView");
  return { default: module.McpAppView };
});

function hasMcpAppResource(tool: ToolEntry): boolean {
  const ui = tool.meta?.ui;
  const nested = ui && typeof ui === "object" && !Array.isArray(ui)
    ? (ui as Record<string, unknown>).resourceUri
    : undefined;
  const legacy = tool.meta?.["ui/resourceUri"];
  return (typeof nested === "string" && nested.startsWith("ui://")) ||
    (typeof legacy === "string" && legacy.startsWith("ui://"));
}

function pickToolIcon(kind?: string): typeof FileTextIcon {
  switch (kind) {
    case "read":
      return FileTextIcon;
    case "edit":
      return FileEditIcon;
    case "search":
    case "grep":
      return SearchIcon;
    case "execute":
    case "terminal":
      return TerminalIcon;
    case "fetch":
    case "web":
      return GlobeIcon;
    case "think":
      return BrainIcon;
    case "list":
    case "tree":
      return FolderTreeIcon;
    default:
      return WrenchIcon;
  }
}

export function ToolRow({
  tool,
  subagent,
  sessionId,
}: {
  tool: ToolEntry;
  subagent?: SubagentActivity;
  sessionId: string;
}) {
  const status = tool.status ?? "pending";
  const inProgress = status === "in_progress" || status === "pending";
  const Icon = pickToolIcon(tool.kind);
  const verb = pickToolActivityVerb(tool);
  const target = pickToolActivityTarget(tool);

  const hoistedBlocks: ToolContentBlock[] = [];
  const bodyBlocks: ToolContentBlock[] = [];
  for (const block of tool.content ?? []) {
    if (block.type === "content" && block.content?.type === "image") {
      hoistedBlocks.push(block);
    } else {
      bodyBlocks.push(block);
    }
  }

  const hasBody =
    bodyBlocks.length > 0 ||
    !!tool.locations?.length ||
    (tool.rawOutput !== undefined && hoistedBlocks.length === 0);
  const [open, setOpen] = useState(false);
  const stick = useStickToBottomContext();
  const summaryRef = useRef<HTMLElement | null>(null);

  const handleSummaryClick = (_event: ReactMouseEvent) => {
    const scrollElement = stick.scrollRef.current;
    const summaryElement = summaryRef.current;
    if (!scrollElement || !summaryElement) {
      setOpen((current) => !current);
      return;
    }

    stick.stopScroll();
    const before = summaryElement.getBoundingClientRect().top;
    setOpen((current) => !current);
    requestAnimationFrame(() => {
      const after = summaryElement.getBoundingClientRect().top;
      const delta = after - before;
      if (Math.abs(delta) > 0.5) {
        scrollElement.scrollTop += delta;
      }
    });
  };

  return (
    <div className={cn("py-0.5", inProgress && "animate-pulse")}>
      <button
        ref={summaryRef as Ref<HTMLButtonElement>}
        type="button"
        onClick={hasBody ? handleSummaryClick : undefined}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-1.5 rounded text-left text-[13px]",
          hasBody ? "cursor-pointer hover:bg-bg-surface/40" : "cursor-default",
        )}
      >
        {subagent ? (
          <SubagentAvatar avatarId={subagent.avatarId} className="size-[18px]" />
        ) : (
          <Icon
            className={cn(
              "size-3.5 shrink-0",
              status === "failed" ? "text-danger" : "text-fg-muted",
            )}
          />
        )}
        <span
          className={cn(
            "shrink-0",
            status === "failed" ? "text-danger" : "text-fg-muted",
          )}
        >
          {verb}
        </span>
        {target && (
          <span className="min-w-0 truncate text-fg-muted/80" title={target}>
            {target}
          </span>
        )}
        {hasBody && (
          <ChevronRightIcon
            className={cn(
              "ml-auto size-3 shrink-0 text-fg-subtle transition-transform",
              open && "rotate-90",
            )}
          />
        )}
      </button>

      {hasBody && open && (
        <div
          className="ml-5 mt-1 space-y-1.5 overflow-y-auto text-[12px]"
          style={{ maxHeight: "min(480px, 50vh)" }}
        >
          {tool.locations && tool.locations.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tool.locations.map((location, index) =>
                location.path ? (
                  <span
                    key={`${location.path}-${index}`}
                    className="rounded bg-bg-surface/60 px-1.5 py-0.5 font-mono text-[11px] text-fg-muted"
                    title={location.path}
                  >
                    {shortPath(location.path)}
                    {location.line != null ? `:${location.line}` : ""}
                  </span>
                ) : null,
              )}
            </div>
          )}
          {bodyBlocks.map((block, index) => (
            <ToolContentRenderer key={index} block={block} />
          ))}
          {bodyBlocks.length === 0 && tool.rawOutput !== undefined && (
            <ToolRawOutputBody rawOutput={tool.rawOutput} />
          )}
        </div>
      )}

      {hoistedBlocks.length > 0 && (
        <div className="ml-5 mt-1.5 space-y-1.5">
          {hoistedBlocks.map((block, index) => (
            <ToolContentRenderer key={`hoist-${index}`} block={block} />
          ))}
        </div>
      )}

      {hasMcpAppResource(tool) && (
        <Suspense fallback={null}>
          <McpAppView tool={tool} sessionId={sessionId} />
        </Suspense>
      )}
    </div>
  );
}

export function ToolRawOutputBody({ rawOutput }: { rawOutput: unknown }) {
  if (rawOutput && typeof rawOutput === "object" && !Array.isArray(rawOutput)) {
    const receipt = rawOutput as Record<string, unknown>;
    const stdout = typeof receipt["stdout"] === "string"
      ? receipt["stdout"]
      : null;
    const stderr = typeof receipt["stderr"] === "string"
      ? receipt["stderr"]
      : null;
    const exitCode = typeof receipt["exit_code"] === "number"
      ? receipt["exit_code"]
      : null;
    if (stdout !== null) {
      return (
        <div className="space-y-1.5">
          {exitCode != null && exitCode !== 0 && (
            <div className="rounded bg-danger-subtle px-2 py-1 font-mono text-[11px] text-danger">
              exit {exitCode}
            </div>
          )}
          {stdout.length > 0 && (
            <pre className="overflow-x-auto rounded bg-bg-surface/60 p-2 font-mono text-[11px] whitespace-pre-wrap text-fg">
              {stdout}
            </pre>
          )}
          {stderr && stderr.length > 0 && (
            <pre className="overflow-x-auto rounded bg-bg-surface/60 p-2 font-mono text-[11px] whitespace-pre-wrap text-fg-muted">
              {stderr}
            </pre>
          )}
        </div>
      );
    }
  }
  return (
    <pre className="overflow-x-auto rounded bg-bg-surface/60 p-2 font-mono text-[11px] text-fg-muted">
      {safeJson(rawOutput)}
    </pre>
  );
}

export function ToolContentRenderer({ block }: { block: ToolContentBlock }) {
  if (block.type === "diff") {
    return (
      <DiffBlock
        path={block.path}
        oldText={block.oldText}
        newText={block.newText}
      />
    );
  }
  if (block.type === "terminal") {
    return (
      <div className="flex items-center gap-2 rounded bg-bg/70 px-2 py-1 text-fg-muted">
        <TerminalIcon className="size-3 text-fg-subtle" />
        <span className="font-mono text-[11px]">
          terminal {block.terminalId ?? ""}
        </span>
      </div>
    );
  }

  const content = block.content;
  if (!content) return null;
  if (content.type === "text" && content.text) {
    return (
      <pre className="overflow-x-auto rounded bg-bg/70 p-2 font-mono whitespace-pre-wrap">
        {content.text}
      </pre>
    );
  }
  if (content.type === "image") {
    const src = resolveToolImageSource(content);
    if (src) {
      return <img src={src} alt="" className={CHAT_GENERATED_IMAGE_CLASS} />;
    }
  }
  if (content.uri) {
    return (
      <a
        href={content.uri}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 text-fg-muted underline-offset-2 hover:underline"
      >
        <GlobeIcon className="size-3" />
        {content.uri}
      </a>
    );
  }
  return null;
}

function DiffBlock({
  path,
  oldText,
  newText,
}: {
  path?: string;
  oldText?: string;
  newText?: string;
}) {
  const oldLines = (oldText ?? "").split(/\r?\n/);
  const newLines = (newText ?? "").split(/\r?\n/);
  return (
    <div className="overflow-hidden rounded border border-border/40">
      {path && (
        <div className="border-b border-border/40 bg-bg/60 px-2 py-1 font-mono text-[11px] text-fg-muted">
          {path}
        </div>
      )}
      <div className="max-h-[260px] overflow-y-auto font-mono text-[11px]">
        {oldLines.map((line, index) => (
          <div
            key={`old-${index}`}
            className="flex bg-danger-subtle/40 text-danger"
          >
            <span className="w-5 shrink-0 select-none px-1 text-right opacity-60">
              -
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-1">
              {line || " "}
            </span>
          </div>
        ))}
        {newLines.map((line, index) => (
          <div
            key={`new-${index}`}
            className="flex bg-success-subtle/40 text-success"
          >
            <span className="w-5 shrink-0 select-none px-1 text-right opacity-60">
              +
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-1">
              {line || " "}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
