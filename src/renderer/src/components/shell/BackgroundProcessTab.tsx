import { useEffect, useState } from "react";
import { SquareTerminalIcon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import type { AcpTerminalSnapshot, TerminalExitFrame } from "@shared/api.js";

export function BackgroundProcessTab({ terminalId }: { terminalId: string }) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<AcpTerminalSnapshot | null>(null);
  const [killing, setKilling] = useState(false);

  useEffect(() => {
    let disposed = false;
    let offOutput: (() => void) | undefined;
    let offExit: (() => void) | undefined;
    void window.backchat.acpTerminalSnapshot({ terminalId }).then((next) => {
      if (disposed) return;
      setSnapshot(next);
      offOutput = window.backchat.onTerminalOutput((frame) => {
        if (frame.terminalId !== terminalId) return;
        setSnapshot((current) => current
          ? { ...current, output: current.output + frame.chunk }
          : current);
      });
      offExit = window.backchat.onTerminalExit((frame) => {
        if (frame.terminalId !== terminalId) return;
        setSnapshot((current) => current
          ? backgroundSnapshotAfterExit(current, frame)
          : current);
        setKilling(false);
      });
    });
    return () => {
      disposed = true;
      offOutput?.();
      offExit?.();
    };
  }, [terminalId]);

  const kill = async () => {
    setKilling(true);
    try {
      await window.backchat.acpTerminalKill({ terminalId });
    } catch {
      setKilling(false);
    }
  };

  if (!snapshot) {
    return (
      <div
        role="region"
        aria-label={`Background process ${terminalId}`}
        data-testid="background-terminal-detail"
        data-callback-kind="terminal"
        data-terminal-id={terminalId}
        data-terminal-status="loading"
        className="flex h-full items-center justify-center px-3 text-xs text-fg-subtle"
      >
        {t("rightPanel.waitingForOutput")}
      </div>
    );
  }

  return <BackgroundProcessDetails snapshot={snapshot} killing={killing} onStop={kill} />;
}

export function BackgroundProcessDetails({
  snapshot,
  killing,
  onStop,
}: {
  snapshot: AcpTerminalSnapshot;
  killing: boolean;
  onStop: () => void;
}) {
  const { t } = useI18n();
  const command = [snapshot.command, ...snapshot.args].join(" ");
  const presentation = backgroundProcessStatus(snapshot, killing, t);
  return (
    <div
      role="region"
      aria-label={`Background process ${command}`}
      data-testid="background-terminal-detail"
      data-callback-kind="terminal"
      data-terminal-id={snapshot.terminalId}
      data-terminal-status={presentation.status}
      className="flex h-full min-h-0 flex-col px-3 pb-3"
    >
      <div className="flex shrink-0 items-start gap-2 border-b border-border/45 pb-3">
        <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-bg-surface/70 text-fg-subtle">
          <SquareTerminalIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-fg" title={command}>{command}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-fg-subtle">
            <span className={cn("size-1.5 rounded-full", snapshot.exited ? "bg-fg-subtle" : "bg-info")} />
            <span data-testid="background-terminal-status" aria-live="polite">
              {presentation.label}
            </span>
            {snapshot.cwd && <span className="truncate" title={snapshot.cwd}>{snapshot.cwd}</span>}
          </div>
        </div>
        {!snapshot.exited && (
          <Button
            variant="ghost"
            size="xs"
            onClick={onStop}
            loading={killing}
            data-testid="background-terminal-stop"
            aria-label={t("shell.stopBackgroundProcess")}
          >
            <XCircleIcon className="size-3.5" />
            {t("rightPanel.stop")}
          </Button>
        )}
      </div>
      <pre
        data-testid="background-terminal-output"
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words py-3 font-mono text-[11px] leading-5 text-fg-muted"
      >
        {snapshot.output || t("rightPanel.waitingForOutput")}
      </pre>
      {snapshot?.truncated && (
        <p className="shrink-0 border-t border-border/45 pt-2 text-[10px] text-fg-subtle">
          {t("rightPanel.outputTruncated")}
        </p>
      )}
    </div>
  );
}

type Translate = (key: TranslationKey) => string;

export function backgroundProcessStatus(
  snapshot: AcpTerminalSnapshot,
  killing = false,
  translate?: Translate,
): { status: "running" | "cancelling" | "exited" | "failed" | "cancelled"; label: string } {
  const text = (key: TranslationKey, fallback: string) => translate?.(key) ?? fallback;
  if (!snapshot.exited) {
    return killing
      ? { status: "cancelling", label: text("rightPanel.cancelling", "Cancelling") }
      : { status: "running", label: text("rightPanel.running", "Running") };
  }
  const suffix = snapshot.signal
    ? ` · ${snapshot.signal}`
    : snapshot.exitCode != null
      ? ` · code ${snapshot.exitCode}`
      : "";
  if (snapshot.terminationReason === "user_kill") {
    return {
      status: "cancelled",
      label: `${text("rightPanel.cancelled", "Cancelled")}${suffix}`,
    };
  }
  if (snapshot.exitCode === 0 && !snapshot.signal) {
    return {
      status: "exited",
      label: `${text("rightPanel.exited", "Exited")}${suffix}`,
    };
  }
  return {
    status: "failed",
    label: `${text("rightPanel.failed", "Failed")}${suffix}`,
  };
}

export function backgroundSnapshotAfterExit(
  snapshot: AcpTerminalSnapshot,
  frame: Pick<
    TerminalExitFrame,
    "exitCode" | "signal" | "terminationReason"
  >,
): AcpTerminalSnapshot {
  return {
    ...snapshot,
    exited: true,
    exitCode: frame.exitCode,
    signal: frame.signal,
    ...(frame.terminationReason
      ? { terminationReason: frame.terminationReason }
      : {}),
  };
}
