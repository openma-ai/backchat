import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircle2Icon,
  GripVerticalIcon,
  CirclePauseIcon,
  CirclePlayIcon,
  CircleDashedIcon,
  ExternalLinkIcon,
  FilesIcon,
  ListChecksIcon,
  PencilIcon,
  RadioTowerIcon,
  SendHorizontalIcon,
  SquareTerminalIcon,
  TargetIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  composerProgressSummary,
  type ComposerProgressCallbacks,
  type ComposerProgressItem,
  type ComposerProgressPresentation,
} from "@/lib/composer-progress";
import type { ComposerActivityModule } from "@/lib/composer-activity-dock";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface ComposerQueuedPrompt {
  turn_id: string;
  text: string;
  created_at: number;
}

export interface ComposerQueueCallbacks {
  update?: (turnId: string, text: string) => void | Promise<void>;
  remove?: (turnId: string) => void | Promise<void>;
  reorder?: (turnIds: string[]) => void | Promise<void>;
  steer?: (turnId: string) => void | Promise<void>;
}

export function ComposerProgress({
  presentation,
  callbacks,
  activityModules = [],
  queuedPrompts = [],
  queueCallbacks,
}: {
  presentation?: ComposerProgressPresentation;
  callbacks?: ComposerProgressCallbacks;
  activityModules?: readonly ComposerActivityModule[];
  queuedPrompts?: ComposerQueuedPrompt[];
  queueCallbacks?: ComposerQueueCallbacks;
}) {
  const { t } = useI18n();
  const model = presentation;
  const presentationKey = model?.id ?? null;
  const [dismissedPresentationKey, setDismissedPresentationKey] =
    useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  useEffect(() => {
    if (!presentationKey) setDismissedPresentationKey(null);
  }, [presentationKey]);
  const visibleModel =
    model && dismissedPresentationKey !== presentationKey ? model : undefined;
  if (
    !visibleModel
    && activityModules.length === 0
    && queuedPrompts.length === 0
  ) return null;

  const items = visibleModel?.items ?? [];
  const progress = composerProgressSummary(items);
  const status = visibleModel?.status?.trim().toLowerCase();
  const actions = visibleModel?.actions;
  const capRows = queuedPrompts.length + (visibleModel ? 1 : 0);
  const invokeAction = (
    action: keyof ComposerProgressCallbacks,
    callback: (() => void | Promise<void>) | undefined,
  ) => {
    if (!callback || pendingAction) return;
    setPendingAction(action);
    void Promise.resolve()
      .then(callback)
      .catch(() => undefined)
      .finally(() => setPendingAction(null));
  };

  return (
    <div
      data-composer-progress="true"
      data-progress-kind={visibleModel?.kind}
      data-progress-status={status}
      data-goal-status={visibleModel?.kind === "goal" ? status : undefined}
      data-current-item={progress.currentItem}
      className="relative z-0 mx-auto !mb-0 flex flex-col items-center gap-1.5"
      style={{ width: "calc(100% - 2 * var(--composer-radius))" }}
    >
      {activityModules.length > 0 ? (
        <ActivityDock modules={activityModules} />
      ) : visibleModel && progress.total > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-progress-step-trigger="true"
              aria-label={`${visibleModel.label}: ${t("chat.stepProgress", {
                current: progress.currentItem,
                total: progress.total,
              })}`}
              className={cn(
                "group flex h-8 items-center gap-2 rounded-full px-3",
                "bg-bg-surface/65 text-xs tabular-nums text-fg-muted ring-1 ring-border/55",
                "hover:bg-bg-surface hover:text-fg hover:ring-border",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/35",
                "transition-colors",
              )}
            >
              <CircleDashedIcon
                className="size-3.5 text-info"
                aria-hidden="true"
              />
              {t("chat.stepProgress", {
                current: progress.currentItem,
                total: progress.total,
              })}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="center"
            side="top"
            sideOffset={8}
            aria-label={visibleModel.label}
            className="composer-action-panel composer-progress-panel liquid-glass composer-card w-[min(420px,calc(100vw-32px))]"
          >
            <ProgressItemList
              items={items}
              currentItem={progress.currentItem}
            />
          </PopoverContent>
        </Popover>
      )}
      {capRows > 0 && <div
          data-progress-cap-viewport="true"
          className="composer-progress-cap-viewport w-full overflow-hidden"
          style={{ height: `${capRows * 36}px` }}
        >
        <div
          data-progress-banner="true"
          className={cn(
            "composer-radius w-full",
            "bg-bg-surface/70 text-sm leading-5 ring-1 ring-border/60",
            "hover:bg-bg-surface/85 hover:ring-border/80",
            "transition-colors",
          )}
          style={{ minHeight: `${capRows * 36 + 20}px` }}
        >
          {queuedPrompts.length > 0 && (
            <div data-composer-queue="true">
              {queuedPrompts.map((prompt, index) => (
                <QueuedPromptRow
                  key={prompt.turn_id}
                  prompt={prompt}
                  index={index}
                  prompts={queuedPrompts}
                  callbacks={queueCallbacks}
                />
              ))}
            </div>
          )}
          {visibleModel && (
            <div
              data-progress-cap-content="true"
              className="flex h-9 w-full items-center gap-2.5 px-4"
            >
              <ProgressKindIcon
                icon={visibleModel.icon}
                className={cn(
                  "size-4 shrink-0",
                  visibleModel.tone === "success"
                    ? "text-success"
                    : visibleModel.tone === "danger"
                      ? "text-danger"
                      : "text-fg-muted",
                )}
              />
              <span className="shrink-0 font-semibold text-fg">
                {visibleModel.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-fg-muted">
                {visibleModel.title}
              </span>
              {visibleModel.elapsedSeconds != null && (
                <span
                  data-progress-elapsed="true"
                  className="shrink-0 tabular-nums text-fg-subtle"
                >
                  · {Math.max(0, Math.round(visibleModel.elapsedSeconds))}s
                </span>
              )}
              {actions && (
                <div className="flex shrink-0 items-center gap-0.5">
                  {actions.edit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={!callbacks?.edit || pendingAction !== null}
                      aria-label="Edit progress"
                      title="Editing requires adapter support"
                    >
                      <PencilIcon className="size-3.5" aria-hidden="true" />
                    </Button>
                  )}
                  {actions.pause && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={!callbacks?.pause || pendingAction !== null}
                      aria-label={t("chat.pauseProgress")}
                      title={t("chat.pauseProgress")}
                      onClick={() => invokeAction("pause", callbacks?.pause)}
                    >
                      <CirclePauseIcon className="size-3.5" aria-hidden="true" />
                    </Button>
                  )}
                  {actions.resume && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={!callbacks?.resume || pendingAction !== null}
                      aria-label={t("chat.resumeProgress")}
                      title={t("chat.resumeProgress")}
                      onClick={() => invokeAction("resume", callbacks?.resume)}
                    >
                      <CirclePlayIcon className="size-3.5" aria-hidden="true" />
                    </Button>
                  )}
                  {actions.dismiss && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("chat.dismissProgress")}
                      title={t("chat.dismissProgress")}
                      onClick={() =>
                        setDismissedPresentationKey(presentationKey)
                      }
                      className="text-fg-subtle hover:text-danger"
                    >
                      <Trash2Icon className="size-3.5" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        </div>}
    </div>
  );
}

function ActivityDock({
  modules,
}: {
  modules: readonly ComposerActivityModule[];
}) {
  const visible = modules.slice(0, 3);
  const overflow = Math.max(0, modules.length - visible.length);
  return (
    <div
      data-activity-dock="true"
      className="flex h-8 max-w-full items-center justify-center gap-1.5"
    >
      {visible.map((module) => (
        <Popover key={module.id}>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-activity-module={module.kind}
              data-activity-module-id={module.id}
              data-activity-module-status={activityModuleStatus(module)}
              aria-label={`${module.label}: ${module.summary}`}
              className={cn(
                "flex h-8 min-w-0 items-center gap-1.5 rounded-full px-3",
                "bg-bg-surface/65 text-xs text-fg-muted ring-1 ring-border/55",
                "hover:bg-bg-surface hover:text-fg hover:ring-border",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/35",
                "transition-colors",
              )}
            >
              <ActivityModuleIcon
                kind={module.kind}
                className="size-3.5 shrink-0 text-info"
              />
              <span className="truncate font-medium">{module.label}</span>
              <span className="shrink-0 tabular-nums text-fg-subtle">
                {module.summary}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="center"
            side="top"
            sideOffset={8}
            aria-label={module.label}
            className="composer-action-panel liquid-glass composer-card w-[min(420px,calc(100vw-32px))]"
          >
            <ActivityModuleItems module={module} />
          </PopoverContent>
        </Popover>
      ))}
      {overflow > 0 && (
        <span
          data-activity-overflow={overflow}
          className="flex h-8 items-center rounded-full bg-bg-surface/65 px-2.5 text-xs text-fg-muted ring-1 ring-border/55"
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

function ActivityModuleItems({
  module,
}: {
  module: ComposerActivityModule;
}) {
  return (
    <div className="space-y-1" role="list">
      {module.items.map((item) => (
        <div
          key={item.id}
          data-activity-item={item.variant ?? item.status}
          data-activity-item-id={item.id}
          data-activity-item-status={item.status}
          className="rounded-lg px-2.5 py-2"
          role="listitem"
        >
          <div className="flex min-w-0 items-center gap-2">
            <CircleDashedIcon className="size-3.5 shrink-0 text-fg-subtle" />
            <span className="min-w-0 flex-1 truncate text-sm text-fg">
              {item.label}
            </span>
            <span className="shrink-0 text-xs text-fg-subtle">
              {item.status}
            </span>
          </div>
          {item.detail && (
            <div className="mt-1 line-clamp-3 pl-5.5 text-xs leading-5 text-fg-muted">
              {item.detail}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ActivityModuleIcon({
  kind,
  className,
}: {
  kind: string;
  className?: string;
}) {
  const Icon = kind === "plan"
    ? ListChecksIcon
    : kind === "monitor"
      ? RadioTowerIcon
      : kind === "elicitation"
        ? ExternalLinkIcon
      : kind === "files"
        ? FilesIcon
        : SquareTerminalIcon;
  return <Icon className={className} aria-hidden="true" />;
}

function activityModuleStatus(module: ComposerActivityModule): string {
  if (module.items.length === 0) return "empty";
  if (module.items.every((item) => item.status === "completed")) return "completed";
  if (module.items.some((item) => item.status === "running")) return "running";
  return module.items[0]!.status;
}

function QueuedPromptRow({
  prompt,
  index,
  prompts,
  callbacks,
}: {
  prompt: ComposerQueuedPrompt;
  index: number;
  prompts: ComposerQueuedPrompt[];
  callbacks?: ComposerQueueCallbacks;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(prompt.text);
  useEffect(() => setDraft(prompt.text), [prompt.text]);

  const reorder = (offset: -1 | 1) => {
    const target = index + offset;
    if (!callbacks?.reorder || target < 0 || target >= prompts.length) return;
    const ordered = prompts.map((entry) => entry.turn_id);
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    void Promise.resolve(callbacks.reorder(ordered)).catch(() => undefined);
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !callbacks?.update) return;
    void Promise.resolve(callbacks.update(prompt.turn_id, text)).catch(() => undefined);
    setEditing(false);
  };

  return (
    <div
      data-queued-turn-id={prompt.turn_id}
      className="flex h-9 min-w-0 items-center gap-2.5 px-4 text-xs"
    >
      <GripVerticalIcon
        data-queue-leading-icon="drag"
        className="size-4 shrink-0 text-fg-subtle"
        aria-hidden="true"
      />
      {editing ? (
        <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={save}>
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={`Queued message ${index + 1}`}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-xs text-fg outline-none focus:border-ring"
          />
          <Button type="submit" variant="ghost" size="xs" disabled={!draft.trim()}>
            Save
          </Button>
        </form>
      ) : (
        <span className="min-w-0 flex-1 truncate font-medium text-fg-muted">
          {prompt.text}
        </span>
      )}
      {!editing && (
        <>
          {index > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={!callbacks?.reorder}
              aria-label={`Move queued message ${index + 1} up`}
              onClick={() => reorder(-1)}
            >
              <ArrowUpIcon className="size-3.5" aria-hidden="true" />
            </Button>
          )}
          {index < prompts.length - 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={!callbacks?.reorder}
              aria-label={`Move queued message ${index + 1} down`}
              onClick={() => reorder(1)}
            >
              <ArrowDownIcon className="size-3.5" aria-hidden="true" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={!callbacks?.steer}
            aria-label={`Steer queued message ${index + 1}`}
            title="Steer queued message"
            onClick={() => {
              void Promise.resolve(callbacks?.steer?.(prompt.turn_id)).catch(
                () => undefined,
              );
            }}
            className="gap-1 px-2 text-xs text-fg-muted"
          >
            <SendHorizontalIcon className="size-3.5" aria-hidden="true" />
            Steer
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!callbacks?.update}
            aria-label={`Edit queued message ${index + 1}`}
            onClick={() => setEditing(true)}
          >
            <PencilIcon className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!callbacks?.remove}
            aria-label={`Remove queued message ${index + 1}`}
            onClick={() => {
              void Promise.resolve(callbacks?.remove?.(prompt.turn_id)).catch(
                () => undefined,
              );
            }}
            className="text-fg-subtle hover:text-danger"
          >
            <Trash2Icon className="size-3.5" aria-hidden="true" />
          </Button>
        </>
      )}
    </div>
  );
}

export function ProgressItemList({
  items,
  currentItem,
}: {
  items: ComposerProgressItem[];
  currentItem: number;
}) {
  return (
    <div
      data-progress-item-list="true"
      className="space-y-0.5"
      role="list"
    >
      {items.map((entry, index) => {
        const active = index + 1 === currentItem;
        const completed = entry.status === "completed";
        return (
          <div
            key={entry.id ?? `${index}:${entry.content}`}
            data-progress-item-status={entry.status ?? "pending"}
            className={cn(
              "flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5",
              active && "bg-bg",
            )}
            role="listitem"
            aria-current={active ? "step" : undefined}
          >
            <ProgressItemIcon status={entry.status} className="size-4" />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm leading-5",
                active
                  ? "font-medium text-fg"
                  : completed
                    ? "text-fg-subtle"
                    : "text-fg-muted",
              )}
            >
              {entry.content}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ProgressKindIcon({
  icon,
  className,
}: {
  icon?: ComposerProgressPresentation["icon"];
  className?: string;
}) {
  const Icon =
    icon === "command"
      ? SquareTerminalIcon
      : icon === "plan"
        ? ListChecksIcon
        : TargetIcon;
  return <Icon className={className} aria-hidden="true" />;
}

function ProgressItemIcon({
  status,
  className,
}: {
  status?: string;
  className?: string;
}) {
  if (status === "completed") {
    return <CheckCircle2Icon className={cn(className, "text-success")} />;
  }
  return (
    <CircleDashedIcon
      className={cn(
        className,
        status === "in_progress" ? "text-fg" : "text-fg-subtle",
      )}
    />
  );
}
