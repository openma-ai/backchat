import { useEffect, type ReactNode } from "react";
import { ChevronDownIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { resolveAskDismissal } from "@/lib/composer-ask-decision";
import type { BrokerAsk } from "@/lib/session-store";
import { cn } from "@/lib/utils";
import type { ElicitationResponseInfo } from "@shared/api.js";
import { ElicitationAskForm } from "./ElicitationAskForm";
import {
  ToolActivityIdentity,
  ToolInputBlock,
  toolSurfaceLabel,
} from "./ToolActivityPrimitives";

export type ComposerBrokerAskProps = {
  ask: BrokerAsk;
  onResolve: (
    optionId: string | null,
    approve?: boolean,
    elicitation?: ElicitationResponseInfo,
  ) => void | Promise<void>;
};

export function ComposerBrokerAsk({
  ask,
  onResolve,
}: ComposerBrokerAskProps) {
  const dismiss = () => {
    if (ask.kind === "elicitation") {
      void onResolve(null, undefined, { action: "cancel" });
      return;
    }
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
      if (event.defaultPrevented || eventTargetsComposerTransientSurface(event)) return;
      if (hasOpenComposerTransientSurface()) return;
      event.preventDefault();
      dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ask, onResolve]);

  if (ask.kind === "permission") {
    const permission = ask.ask;
    const allowOptions = permission.options.filter(
      (option) => !option.kind.startsWith("reject_"),
    );
    const rejectOptions = permission.options.filter((option) =>
      option.kind.startsWith("reject_"),
    );
    const primaryAllow =
      allowOptions.find((option) => option.kind === "allow_once")
      ?? allowOptions[0]
      ?? null;
    const moreOptions = [
      ...allowOptions.filter((option) => option !== primaryAllow),
      ...rejectOptions.slice(1),
    ];
    const primaryReject = rejectOptions[0] ?? null;
    return (
      <AskSheet
        title={permission.presentation.title}
        meta={permission.presentation.kind}
        eyebrow="Approval required"
        toolKind={permission.presentation.kind}
        toolTarget={permissionToolTarget(
          permission.presentation.title,
          permission.presentation.kind,
        )}
        onClose={dismiss}
      >
        {(permission.presentation.reason || permission.presentation.command) && (
          <div className="min-w-0">
            {permission.presentation.reason && (
              <p className="px-2 text-sm font-medium leading-5 text-fg">
                {permission.presentation.reason}
              </p>
            )}
            {!permission.presentation.reason && (
              <p className="px-2 text-sm font-medium leading-5 text-fg">
                Allow {permission.presentation.title} to run this action?
              </p>
            )}
            {permission.presentation.command && (
              <ToolInputBlock
                id={permission.requestId}
                variant="approval"
              >
                {permission.presentation.command}
              </ToolInputBlock>
            )}
          </div>
        )}
        <div
          className="mt-3 flex flex-wrap items-center justify-end gap-2"
          data-codex-approval-actions="true"
        >
          {primaryReject && (
            <Button
              data-permission-reject-action="true"
              type="button"
              variant="outline"
              size="sm"
              className="min-w-[5rem] rounded-full bg-transparent text-fg hover:bg-bg-surface hover:text-fg dark:bg-transparent"
              onClick={() => void onResolve(primaryReject.optionId)}
            >
              {primaryReject.name}
            </Button>
          )}
          {primaryAllow ? (
            <div className="flex items-stretch overflow-hidden rounded-full bg-fg text-bg dark:bg-neutral-950 dark:text-neutral-100">
              <Button
                data-permission-primary-action="true"
                type="button"
                size="sm"
                className={cn(
                  "min-w-[6.5rem] rounded-none border-0 bg-transparent text-current hover:bg-transparent",
                  moreOptions.length > 0 && "pr-2",
                )}
                onClick={() => void onResolve(primaryAllow.optionId)}
              >
                {primaryAllow.name}
              </Button>
              {moreOptions.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      aria-label="More approval options"
                      className="min-w-8 rounded-none border-0 bg-transparent px-2 text-current hover:bg-transparent"
                    >
                      <ChevronDownIcon className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="end" className="w-52">
                    {moreOptions.map((option) => (
                      <DropdownMenuItem
                        key={option.optionId}
                        variant={option.kind.startsWith("reject_") ? "destructive" : "default"}
                        onSelect={() => void onResolve(option.optionId)}
                      >
                        {option.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ) : (
            permission.options.map((option) => (
              <Button
                key={option.optionId}
                type="button"
                variant={option.kind.startsWith("reject_") ? "destructive" : "outline"}
                size="sm"
                onClick={() => void onResolve(option.optionId)}
              >
                {option.name}
              </Button>
            ))
          )}
        </div>
      </AskSheet>
    );
  }

  if (ask.kind === "elicitation") {
    if (ask.ask.mode === "url") {
      return (
        <AskSheet
          title={ask.ask.message}
          meta={ask.ask.url}
          eyebrow="Confirmation required"
          onClose={dismiss}
        >
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void onResolve(null, undefined, { action: "decline" })}
            >
              Decline
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void onResolve(null, undefined, { action: "accept" })}
            >
              Open {elicitationUrlHost(ask.ask.url)}
            </Button>
          </div>
        </AskSheet>
      );
    }
    return (
      <AskSheet title={ask.ask.message} onClose={dismiss}>
        <ElicitationAskForm
          ask={ask.ask}
          onSubmit={(response) => onResolve(null, undefined, response)}
        />
      </AskSheet>
    );
  }

  const write = ask.ask;
  return (
    <AskSheet
      title="Write outside workspace?"
      meta={write.path}
      footerMeta={`${write.byteSize}B`}
      eyebrow="Filesystem approval"
      onClose={dismiss}
    >
      {write.newPreview && (
        <pre className="max-h-28 overflow-auto rounded-md bg-bg/65 px-3 py-2.5 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all text-fg-muted">
          {write.newPreview}
        </pre>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => void onResolve(null, false)}>
          Deny
        </Button>
        <Button type="button" size="sm" onClick={() => void onResolve(null, true)}>
          Allow write
        </Button>
      </div>
    </AskSheet>
  );
}

/** @deprecated Use ComposerBrokerAsk in the composer's occupied content slot. */
export function InlineAskPanel(props: ComposerBrokerAskProps) {
  return <ComposerBrokerAsk {...props} />;
}

function elicitationUrlHost(url: string): string {
  try {
    return new URL(url).host || "external page";
  } catch {
    return "external page";
  }
}

function permissionToolTarget(title: string, kind?: string): string | undefined {
  const normalized = title.trim().toLowerCase();
  if (
    (kind === "execute" || kind === "terminal")
    && ["bash", "shell", "terminal", "execute", "run command"].includes(normalized)
  ) return undefined;
  return title;
}

function eventTargetsComposerTransientSurface(event: KeyboardEvent): boolean {
  return event.composedPath().some(
    (node) => node instanceof Element && node.matches(
      '[data-slot="dropdown-menu-content"], [data-slot="select-content"], [data-slot="popover-content"], [role="menu"], [role="listbox"]',
    ),
  );
}

function hasOpenComposerTransientSurface(): boolean {
  return Boolean(document.querySelector(
    '[data-slot="dropdown-menu-content"][data-state="open"], [data-slot="select-content"][data-state="open"], [data-slot="popover-content"][data-state="open"]',
  ));
}

function AskSheet({
  title,
  meta,
  footerMeta,
  eyebrow,
  toolKind,
  toolTarget,
  onClose,
  children,
}: {
  title: string;
  meta?: string;
  footerMeta?: string;
  eyebrow?: string;
  toolKind?: string;
  toolTarget?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      data-composer-ask-slot="true"
      className={cn(
        "flex min-h-[108px] w-full flex-col overflow-hidden max-h-[60vh]",
      )}
      role="group"
      aria-label={eyebrow ?? title}
    >
      {toolKind ? (
        <div className="flex min-w-0 items-center gap-2 px-2 pt-1 pb-4 text-sm">
          <ToolActivityIdentity
            kind={toolKind}
            label={toolSurfaceLabel(toolKind)}
            target={toolTarget}
          />
        </div>
      ) : (
        <div className="flex items-start gap-2 px-1 pt-1 pb-2">
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <div className="text-[10px] font-medium text-fg-subtle">
                {eyebrow}
              </div>
            )}
            <div className="mt-0.5 flex min-w-0 items-center gap-2">
              <div className="truncate text-sm font-semibold text-fg" title={title}>{title}</div>
              {meta && (
                <span className="shrink-0 rounded-md bg-bg/60 px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle">
                  {meta}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-bg/60 hover:text-fg"
            aria-label="Dismiss"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}
      <div className="flex flex-col overflow-y-auto px-1 pb-1">
        {children}
      </div>
      {footerMeta && (
        <div className="px-1 pt-1 text-right font-mono text-[10px] text-fg-subtle">
          {footerMeta}
        </div>
      )}
    </div>
  );
}
