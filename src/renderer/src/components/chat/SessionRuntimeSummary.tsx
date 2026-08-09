import type { SessionRow } from "@/lib/session-store";
import {
  contextUsagePresentation,
  sessionRuntimeStatusPresentation,
  visibleCapabilityLabels,
} from "@/components/shell/context-usage";
import { cn } from "@/lib/utils";
import { RuntimeLocationControl } from "./RuntimeLocationControl";

type RuntimeMethodCapability = {
  label: string;
  supported: boolean | undefined;
};

function compactTokenCount(value: number): string {
  if (value < 1_000) return String(Math.round(value));
  const abbreviated = value / 1_000;
  return `${abbreviated >= 10 ? Math.round(abbreviated) : abbreviated.toFixed(1)}k`;
}

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
  const usagePercentage = session.usage
    ? Math.min(100, Math.max(0, Math.round((session.usage.used / session.usage.size) * 100)))
    : 0;
  const terminated = runtimeStatus.state === "terminated";
  const runtimeTitle = [
    `${identity.name}${identity.version ? ` ${identity.version}` : ""}`,
    runtimeStatus.label,
    session.cwd || undefined,
  ].filter(Boolean).join(" · ");

  return (
    <section
      aria-label="Session runtime"
      data-gui-feature="session.initialize-ready"
      data-session-runtime="true"
      data-session-id={session.id}
      className="mb-[var(--row-gap-y)] flex h-[var(--row-h)] shrink-0 items-center justify-between px-2 text-xs text-fg-muted"
    >
      <RuntimeLocationControl title={runtimeTitle} />
      {usage ? (
        <span
          aria-label={usage.title}
          data-gui-feature="output.usage-parent"
          data-usage-scope="parent"
          data-context-used={session.usage?.used}
          data-context-size={session.usage?.size}
          title={usage.title}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 tabular-nums",
            usage.tone === "warning" && "text-warning",
            usage.tone === "danger" && "text-danger",
            usage.tone === "muted" && "text-fg-subtle",
          )}
        >
          <span data-context-token-count="true">
            {compactTokenCount(session.usage!.used)} / {compactTokenCount(session.usage!.size)}
          </span>
          <svg viewBox="0 0 16 16" className="size-4 -rotate-90" aria-hidden="true">
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              pathLength="100"
              strokeDasharray={`${usagePercentage} 100`}
            />
          </svg>
          <span className="sr-only">{usage.title}</span>
        </span>
      ) : null}

      <span data-session-runtime-details="true" className="sr-only">
        <span data-session-agent-name>{identity.name}</span>
        {identity.version && <span data-session-agent-version>{identity.version}</span>}
        {session.protocolVersion !== undefined && (
          <span data-session-protocol>ACP v{session.protocolVersion}</span>
        )}
        <span
          role="status"
          aria-label={`Session status: ${runtimeStatus.label}`}
          data-gui-feature="output.session-status-goal-queue"
          data-session-status={runtimeStatus.state}
        >
          {runtimeStatus.label}
        </span>
        {terminated && (
          <span
            aria-disabled="true"
            data-gui-feature="session.close-terminated"
            data-session-terminated="true"
          >
            Composer disabled
          </span>
        )}
        <span data-gui-feature="session.new-workspace" data-session-cwd={session.cwd}>
          CWD {session.cwd || "—"}
        </span>
        {(session.additionalDirectories ?? []).map((directory) => (
          <span key={directory} data-session-additional-directory={directory}>
            + {directory}
          </span>
        ))}
        {capabilities.map((capability) => (
          <span key={capability} data-session-capability={capability}>{capability}</span>
        ))}
        <span data-session-queue-depth={queueDepth}>Queue {queueDepth}</span>
        {session.goal && (
          <span data-session-goal-status={session.goal.status}>
            Goal {session.goal.objective} · {session.goal.status}
          </span>
        )}
      </span>
    </section>
  );
}
