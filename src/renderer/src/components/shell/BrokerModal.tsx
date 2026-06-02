/**
 * Global broker modal — listens for pushes from main (permission asks +
 * out-of-cwd fs write asks) and renders one shared modal queue. Mounted
 * once at AppShell scope so it overlays whatever route is showing.
 *
 * Why one queue: the ACP child is blocking on each request synchronously,
 * but the agent can fire several before any are answered (rare — claude-
 * acp typically asks once per tool — but easy to handle). We show them
 * one at a time, FIFO.
 */

import { useEffect, useState } from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ShieldCheckIcon,
  ShieldXIcon,
  XCircleIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FsWriteAskInfo, PermissionAskInfo } from "@shared/api.js";

type QueueItem =
  | { kind: "permission"; ask: PermissionAskInfo }
  | { kind: "fsWrite"; ask: FsWriteAskInfo };

export function BrokerModal() {
  const [queue, setQueue] = useState<QueueItem[]>([]);

  useEffect(() => {
    const offP = window.openma.onPermissionRequest((ask) =>
      setQueue((q) => [...q, { kind: "permission", ask }]),
    );
    const offF = window.openma.onFsWriteApproval((ask) =>
      setQueue((q) => [...q, { kind: "fsWrite", ask }]),
    );
    return () => {
      offP();
      offF();
    };
  }, []);

  const head = queue[0];
  if (!head) return null;

  const pop = () => setQueue((q) => q.slice(1));

  return (
    <Dialog open onOpenChange={(open) => { if (!open) pop(); }}>
      <DialogContent className="!max-w-md gap-0 p-0">
        {head.kind === "permission" ? (
          <PermissionBody
            ask={head.ask}
            onPick={async (optionId) => {
              await window.openma.permissionRespond(head.ask.requestId, optionId);
              pop();
            }}
          />
        ) : (
          <FsWriteBody
            ask={head.ask}
            onPick={async (approved) => {
              await window.openma.fsApprovalRespond(head.ask.requestId, approved);
              pop();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PermissionBody({
  ask,
  onPick,
}: {
  ask: PermissionAskInfo;
  onPick: (optionId: string | null) => void;
}) {
  const tool = ask.toolCall as
    | { title?: string; kind?: string; rawInput?: unknown }
    | undefined;
  return (
    <>
      <DialogHeader className="border-b border-border/40 px-5 py-4">
        <DialogTitle className="text-sm font-medium">Agent permission request</DialogTitle>
        <DialogDescription className="text-xs text-fg-muted">
          The agent wants to run a tool. You stay in control.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 px-5 py-4 text-sm">
        <div className="rounded-md bg-bg-surface/60 p-3">
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <span className="font-mono">{tool?.kind ?? "tool"}</span>
            <span>·</span>
            <span className="truncate">{tool?.title ?? "(no title)"}</span>
          </div>
          {tool?.rawInput !== undefined && (
            <pre className="mt-2 max-h-32 overflow-y-auto rounded bg-bg/70 p-2 font-mono text-[11px]">
              {safeJson(tool.rawInput)}
            </pre>
          )}
        </div>
      </div>
      <DialogFooter className="flex flex-col gap-1 border-t border-border/40 bg-bg-surface/30 px-5 py-3 sm:flex-col">
        {ask.options.map((opt) => (
          <PermissionOptionButton
            key={opt.optionId}
            kind={opt.kind}
            name={opt.name}
            onClick={() => onPick(opt.optionId)}
          />
        ))}
      </DialogFooter>
    </>
  );
}

function PermissionOptionButton({
  kind,
  name,
  onClick,
}: {
  kind: PermissionAskInfo["options"][number]["kind"];
  name: string;
  onClick: () => void;
}) {
  const config = {
    allow_once: {
      icon: CheckCircle2Icon,
      cls: "bg-brand text-brand-fg hover:bg-brand-hover",
    },
    allow_always: {
      icon: ShieldCheckIcon,
      cls: "bg-brand-subtle text-brand-fg hover:bg-brand-subtle/70",
    },
    reject_once: {
      icon: XCircleIcon,
      cls: "bg-bg-surface text-fg hover:bg-bg-surface/70",
    },
    reject_always: {
      icon: ShieldXIcon,
      cls: "bg-danger-subtle text-danger hover:bg-danger-subtle/70",
    },
  }[kind] ?? { icon: CheckCircle2Icon, cls: "bg-bg-surface text-fg" };
  const Icon = config.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
        config.cls,
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="flex-1">{name}</span>
    </button>
  );
}

function FsWriteBody({
  ask,
  onPick,
}: {
  ask: FsWriteAskInfo;
  onPick: (approved: boolean) => void;
}) {
  return (
    <>
      <DialogHeader className="border-b border-border/40 px-5 py-4">
        <DialogTitle className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangleIcon className="size-4 text-warning" />
          Write outside workspace?
        </DialogTitle>
        <DialogDescription className="font-mono text-xs text-fg-muted">
          {ask.path}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2 px-5 py-4 text-xs">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-fg-subtle">
            Proposed content ({ask.byteSize} bytes)
          </div>
          <pre className="max-h-40 overflow-y-auto rounded bg-bg-surface p-2 font-mono">
            {ask.newPreview}
            {ask.byteSize > ask.newPreview.length && "\n…"}
          </pre>
        </div>
        {ask.oldPreview && (
          <details className="text-fg-muted">
            <summary className="cursor-pointer">Current file content</summary>
            <pre className="mt-1 max-h-40 overflow-y-auto rounded bg-bg-surface p-2 font-mono">
              {ask.oldPreview}
            </pre>
          </details>
        )}
      </div>
      <DialogFooter className="gap-2 border-t border-border/40 bg-bg-surface/30 px-5 py-3">
        <Button variant="ghost" size="sm" onClick={() => onPick(false)}>
          Deny
        </Button>
        <Button size="sm" onClick={() => onPick(true)}>
          Allow this write
        </Button>
      </DialogFooter>
    </>
  );
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
