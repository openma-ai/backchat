import type { SessionRow } from "@/lib/session-store";
import {
  contextUsagePresentation,
  sessionRuntimeStatusPresentation,
  visibleCapabilityLabels,
} from "@/components/shell/context-usage";
import { cn } from "@/lib/utils";

type RuntimeMethodCapability = {
  label: string;
  supported: boolean | undefined;
};

function runtimeAgentIdentity(row: SessionRow): { name: string; version?: string } {
  const info = row.agentInfo;
  if (!info || typeof info !== "object" || Array.isArray(info)) {
    return { name: row.agent_id };
  }
  const record = info as Record<string, unknown>;
  return {
    name:
      typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : row.agent_id,
    version:
      typeof record.version === "string" && record.version.trim()
        ? record.version.trim()
        : undefined,
  };
}

function methodCapabilityLabels(row: SessionRow): string[] {
  const methods: RuntimeMethodCapability[] = [
    { label: "session.fork", supported: row.supportsSessionFork },
    { label: "session.list", supported: row.supportsSessionList },
    { label: "session.delete", supported: row.supportsSessionDelete },
    { label: "session.resume", supported: row.supportsSessionResume },
    { label: "session.close", supported: row.supportsSessionClose },
    { label: "additionalDirectories", supported: row.supportsAdditionalDirectories },
    { label: "logout", supported: row.supportsLogout },
    { label: "providers", supported: row.supportsProviders },
    { label: "nes", supported: row.supportsNes },
    { label: "steering", supported: row.supportsSteering },
  ];
  return methods.filter((method) => method.supported).map((method) => method.label);
}

export function SessionRuntimeSummary({
  session,
  queueDepth = 0,
}: {
  session: SessionRow;
  queueDepth?: number;
}) {
  const identity = runtimeAgentIdentity(session);
  const runtimeStatus = sessionRuntimeStatusPresentation(session.status);
  const capabilities = Array.from(new Set([
    ...visibleCapabilityLabels(session.agentCapabilities),
    ...methodCapabilityLabels(session),
  ]));
  const usage = session.usage ? contextUsagePresentation(session.usage) : undefined;
  const terminated = runtimeStatus.state === "terminated";

  return (
    <section
      aria-label="Session runtime"
      data-gui-feature="session.initialize-ready"
      data-session-runtime="true"
      data-session-id={session.id}
      className="mx-4 mt-3 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-bg-surface/70 px-3 py-2 text-[11px] text-fg-muted"
    >
      <span data-session-agent-name className="font-medium text-fg">
        {identity.name}
      </span>
      {identity.version && (
        <span data-session-agent-version>{identity.version}</span>
      )}
      {session.protocolVersion !== undefined && (
        <span data-session-protocol>ACP v{session.protocolVersion}</span>
      )}
      <span
        role="status"
        aria-label={`Session status: ${runtimeStatus.label}`}
        data-gui-feature="output.session-status-goal-queue"
        data-session-status={runtimeStatus.state}
        className={cn(
          "rounded-full px-2 py-0.5 font-medium",
          runtimeStatus.state === "running" && "bg-warning/15 text-warning",
          runtimeStatus.state === "idle" && "bg-success/15 text-success",
          runtimeStatus.state === "terminated" && "bg-danger/15 text-danger",
        )}
      >
        {runtimeStatus.label}
      </span>
      {terminated && (
        <span
          aria-disabled="true"
          data-gui-feature="session.close-terminated"
          data-session-terminated="true"
          className="font-medium text-danger"
        >
          Composer disabled
        </span>
      )}
      <span
        data-gui-feature="session.new-workspace"
        data-session-cwd={session.cwd}
        title={session.cwd}
        className="max-w-[28rem] truncate"
      >
        CWD {session.cwd || "—"}
      </span>
      {(session.additionalDirectories ?? []).map((directory) => (
        <span
          key={directory}
          data-session-additional-directory={directory}
          title={directory}
          className="max-w-[24rem] truncate"
        >
          + {directory}
        </span>
      ))}
      {capabilities.length > 0 && (
        <span data-session-capabilities className="contents">
          {capabilities.map((capability) => (
            <span
              key={capability}
              data-session-capability={capability}
              className="rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle"
            >
              {capability}
            </span>
          ))}
        </span>
      )}
      {usage && (
        <span
          aria-label={usage.title}
          data-gui-feature="output.usage-parent"
          data-usage-scope="parent"
          data-context-used={session.usage?.used}
          data-context-size={session.usage?.size}
          className="font-medium text-fg"
        >
          {usage.title}
        </span>
      )}
      <span data-session-queue-depth={queueDepth}>Queue {queueDepth}</span>
      {session.goal && (
        <span
          data-session-goal-status={session.goal.status}
          title={session.goal.objective}
          className="max-w-[28rem] truncate"
        >
          Goal {session.goal.objective} · {session.goal.status}
        </span>
      )}
    </section>
  );
}
