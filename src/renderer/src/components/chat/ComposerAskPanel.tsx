import { useEffect, type ReactNode } from "react";
import { XIcon } from "lucide-react";
import { resolveAskDismissal } from "@/lib/composer-ask-decision";
import type { BrokerAsk } from "@/lib/session-store";
import { cn } from "@/lib/utils";

export function InlineAskPanel({
  ask,
  onResolve,
}: {
  ask: BrokerAsk;
  onResolve: (
    optionId: string | null,
    approve?: boolean,
  ) => void | Promise<void>;
}) {
  const dismiss = () => {
    const resolution = resolveAskDismissal(ask);
    if (resolution.approve === undefined) {
      void onResolve(resolution.optionId);
    } else {
      void onResolve(resolution.optionId, resolution.approve);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ask, onResolve]);

  if (ask.kind === "permission") {
    const permission = ask.ask;
    const tool = permission.toolCall as
      | { title?: string; kind?: string }
      | undefined;
    const title = tool?.title ?? "Approve this action?";
    return (
      <AskSheet title={title} meta={tool?.kind} onClose={dismiss}>
        {permission.options.map((option) => {
          const isPrimary =
            option.kind === "allow_once" || option.kind === "allow_always";
          const isDanger = option.kind.startsWith("reject_");
          return (
            <AskOption
              key={option.optionId}
              label={option.name}
              tone={isPrimary ? "primary" : isDanger ? "danger" : "neutral"}
              onClick={() => void onResolve(option.optionId)}
            />
          );
        })}
      </AskSheet>
    );
  }

  const write = ask.ask;
  return (
    <AskSheet
      title="Write outside workspace?"
      meta={write.path}
      footerMeta={`${write.byteSize}B`}
      onClose={dismiss}
    >
      <AskOption
        label="Allow this write"
        tone="primary"
        onClick={() => void onResolve(null, true)}
      />
      <AskOption
        label="Deny"
        tone="danger"
        onClick={() => void onResolve(null, false)}
      />
    </AskSheet>
  );
}

function AskSheet({
  title,
  meta,
  footerMeta,
  onClose,
  children,
}: {
  title: string;
  meta?: string;
  footerMeta?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute left-3 right-3 bottom-full mb-2 z-30",
        "rounded-2xl border border-border/60 bg-bg-surface/95 backdrop-blur",
        "shadow-xl",
        "flex flex-col",
        "max-h-[60vh]",
      )}
      role="dialog"
      aria-label={title}
    >
      <div className="flex items-start gap-2 px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-fg">{title}</div>
          {meta && (
            <div className="mt-0.5 truncate font-mono text-[11px] text-fg-subtle">
              {meta}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-fg-subtle hover:bg-bg/60 hover:text-fg"
          aria-label="Dismiss"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-1 overflow-y-auto px-2 pb-2">
        {children}
      </div>
      {footerMeta && (
        <div className="border-t border-border/40 px-4 py-1.5 text-right text-[11px] text-fg-subtle">
          {footerMeta}
        </div>
      )}
    </div>
  );
}

function AskOption({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: "primary" | "danger" | "neutral";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
        "flex items-center justify-between gap-2",
        tone === "primary"
          ? "bg-bg/70 text-fg hover:bg-bg"
          : tone === "danger"
            ? "text-danger hover:bg-danger-subtle/40"
            : "text-fg-muted hover:bg-bg/60 hover:text-fg",
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
