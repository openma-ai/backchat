export interface ComposerProgressItem {
  id?: string;
  content: string;
  status?: "pending" | "in_progress" | "completed";
}

export interface ComposerProgressPresentation {
  id: string;
  kind: string;
  label: string;
  title?: string;
  status?: string;
  icon?: "target" | "plan" | "command";
  tone?: "neutral" | "success" | "danger";
  elapsedSeconds?: number;
  items?: ComposerProgressItem[];
  actions?: {
    edit?: boolean;
    pause?: boolean;
    resume?: boolean;
    dismiss?: boolean;
  };
}

export interface ComposerProgressCallbacks {
  edit?: () => void | Promise<void>;
  pause?: () => void | Promise<void>;
  resume?: () => void | Promise<void>;
}

export interface ComposerProgressSummary {
  currentItem: number;
  total: number;
  completed: number;
}

/** Summarize an explicitly bound progress list for the reusable composer
 * surface. The items are a UI-domain model, not raw ACP plan entries. */
export function composerProgressSummary(
  items: readonly Pick<ComposerProgressItem, "content" | "status">[],
): ComposerProgressSummary {
  const total = items.length;
  const completed = items.filter((item) => item.status === "completed").length;
  if (total === 0) return { currentItem: 0, total, completed };

  const activeIndex = items.findIndex((item) => item.status === "in_progress");
  const pendingIndex = items.findIndex((item) => item.status !== "completed");
  const currentIndex =
    activeIndex >= 0
      ? activeIndex
      : pendingIndex >= 0
        ? pendingIndex
        : total - 1;
  return { currentItem: currentIndex + 1, total, completed };
}
