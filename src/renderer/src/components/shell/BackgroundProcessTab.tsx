import { useEffect, useState } from "react";
import { SquareTerminalIcon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { AcpTerminalSnapshot } from "@shared/api.js";

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
          ? { ...current, exited: true, exitCode: frame.exitCode, signal: frame.signal }
          : current);
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
    } finally {
      setKilling(false);
    }
  };

  const command = snapshot
    ? [snapshot.command, ...snapshot.args].join(" ")
    : terminalId;
  const status = snapshot?.exited
    ? snapshot.exitCode === 0 ? t("rightPanel.exited") : t("rightPanel.failed")
    : t("rightPanel.running");

  return (
    <div className="flex h-full min-h-0 flex-col px-3 pb-3">
      <div className="flex shrink-0 items-start gap-2 border-b border-border/45 pb-3">
        <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-bg-surface/70 text-fg-subtle">
          <SquareTerminalIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-fg" title={command}>{command}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-fg-subtle">
            <span className={cn("size-1.5 rounded-full", snapshot?.exited ? "bg-fg-subtle" : "bg-info")} />
            <span>{status}</span>
            {snapshot?.cwd && <span className="truncate" title={snapshot.cwd}>{snapshot.cwd}</span>}
          </div>
        </div>
        {!snapshot?.exited && (
          <Button variant="ghost" size="xs" onClick={() => void kill()} loading={killing}>
            <XCircleIcon className="size-3.5" />
            {t("rightPanel.stop")}
          </Button>
        )}
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words py-3 font-mono text-[11px] leading-5 text-fg-muted">
        {snapshot?.output || t("rightPanel.waitingForOutput")}
      </pre>
      {snapshot?.truncated && (
        <p className="shrink-0 border-t border-border/45 pt-2 text-[10px] text-fg-subtle">
          {t("rightPanel.outputTruncated")}
        </p>
      )}
    </div>
  );
}
