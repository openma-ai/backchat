import { Fragment, type ReactElement } from "react";
import { ContextMenu } from "radix-ui";
import { toast } from "sonner";

import {
  openExternalBrowserUrl,
  openInAppBrowserUrl,
} from "@/lib/browser-open";
import { useI18n } from "@/lib/i18n";

export type MarkdownLinkMenuActionId = "open-in-app" | "open-external" | "copy";

export interface MarkdownLinkMenuAction {
  id: MarkdownLinkMenuActionId;
  run: () => void | Promise<void>;
}

export function markdownLinkMenuActions({
  url,
  label,
  openInApp,
  openExternal,
  copy,
}: {
  url: string;
  label?: string;
  openInApp: (url: string, label?: string) => void;
  openExternal: (url: string) => void;
  copy: (url: string) => void | Promise<void>;
}): MarkdownLinkMenuAction[] {
  return [
    { id: "open-in-app", run: () => openInApp(url, label) },
    { id: "open-external", run: () => openExternal(url) },
    { id: "copy", run: () => copy(url) },
  ];
}

export function MarkdownLinkMenuContent({
  url,
  label,
}: {
  url: string;
  label?: string;
}) {
  const { t } = useI18n();
  const actions = markdownLinkMenuActions({
    url,
    label,
    openInApp: openInAppBrowserUrl,
    openExternal: openExternalBrowserUrl,
    copy: async (value) => {
      try {
        await navigator.clipboard.writeText(value);
        toast.success(t("chat.linkCopied"));
      } catch {
        toast.error(t("chat.linkCopyFailed"));
      }
    },
  });
  const labels: Record<MarkdownLinkMenuActionId, string> = {
    "open-in-app": t("chat.openInBrowser"),
    "open-external": t("chat.openInExternalBrowser"),
    copy: t("chat.copyLink"),
  };

  return (
    <ContextMenu.Portal>
      <ContextMenu.Content className="app-select-content z-50 min-w-[190px] overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
        {actions.map((action, index) => (
          <Fragment key={action.id}>
            {index === 2 && (
              <ContextMenu.Separator className="app-select-separator -mx-1 my-1 h-px bg-border" />
            )}
            <ContextMenu.Item
              onSelect={() => void action.run()}
              className="app-select-item app-select-focus flex cursor-default select-none items-center rounded-md px-2 py-1.5 text-[13px] outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              data-markdown-link-action={action.id}
            >
              {labels[action.id]}
            </ContextMenu.Item>
          </Fragment>
        ))}
      </ContextMenu.Content>
    </ContextMenu.Portal>
  );
}

export function MarkdownLinkMenu({
  url,
  label,
  children,
}: {
  url: string;
  label?: string;
  children: ReactElement;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <MarkdownLinkMenuContent url={url} label={label} />
    </ContextMenu.Root>
  );
}
