import { useQuery } from "@tanstack/react-query";
import { CheckCircle2Icon, CircleIcon, ExternalLinkIcon, KeyRoundIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSettings, patchSettings } from "@/lib/settings-store";
import type { AcpAuthMethodsResult } from "@shared/api.js";

/**
 * Settings → Agents.
 *
 * The user picks ONE default agent (radio across detected agents). New chats
 * spawn that agent — the "default browser" model. Per-agent overrides
 * (custom command, env vars for ANTHROPIC_API_KEY etc.) are out of scope
 * for the first pass; we'll add inline expanders in a follow-up if real
 * users need them.
 *
 * Undetected agents are listed in a dim row with their installHint so the
 * user can copy/paste the command into their terminal.
 */
export function SettingsAgents() {
  const settings = useSettings();
  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: () => window.backchat.agentsList(),
  });

  const defaultId = settings?.default.agent_id ?? "";
  const detected = agents.filter((a) => a.detected);
  const undetected = agents.filter((a) => !a.detected);

  const setDefault = async (id: string) => {
    if (!settings) return;
    await patchSettings({
      default: { ...settings.default, agent_id: id },
    });
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-base font-medium text-fg">Agents</h1>
        <p className="mt-1 text-xs text-fg-muted">
          Pick the ACP agent used when you open a new chat. Detected agents
          come from your <span className="font-mono">$PATH</span>.
        </p>
      </header>

      <section>
        <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-fg-subtle">
          Default agent ({detected.length} detected)
        </h2>
        {detected.length === 0 ? (
          <p className="rounded-md bg-warning-subtle p-3 text-xs text-fg">
            No ACP agents detected. Install one (see below) and restart the app.
          </p>
        ) : (
          <ul className="space-y-1">
            {detected.map((a) => (
              <DetectedAgentRow
                key={a.id}
                agent={a}
                isDefault={defaultId === a.id}
                onSelectDefault={() => setDefault(a.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {undetected.length > 0 && (
        <details className="group">
          {/* Collapsed by default — the registry has ~30 agents, most of
              which the user will never install. The few they have are
              what matters, and they live in the section above. */}
          <summary className="cursor-pointer list-none text-[11px] font-medium uppercase tracking-wider text-fg-subtle hover:text-fg-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="transition-transform group-open:rotate-90">›</span>
              Show {undetected.length} not installed
            </span>
          </summary>
          <ul className="mt-3 space-y-1">
            {undetected.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-md bg-bg-surface/40 px-3 py-2 text-sm text-fg-subtle"
              >
                <CircleIcon className="size-4 shrink-0" />
                <span className="flex-1 truncate">{a.label}</span>
                {a.homepage && (
                  <a
                    href={a.homepage}
                    className="inline-flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg"
                  >
                    <ExternalLinkIcon className="size-3" />
                    homepage
                  </a>
                )}
                {a.installHint && (
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    {a.installHint.length > 32
                      ? a.installHint.slice(0, 32) + "…"
                      : a.installHint}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-fg-subtle">
            Detection re-runs on app launch. Install the agent and restart to see it here.
          </p>
        </details>
      )}
    </div>
  );
}

/** One detected agent row with the default-agent radio AND a sign-in
 *  panel. Auth state stays local because each row probes its own
 *  authMethods on demand — we don't pre-fetch on Settings open (would
 *  spawn N child processes just to list buttons). */
function DetectedAgentRow({
  agent,
  isDefault,
  onSelectDefault,
}: {
  agent: { id: string; label: string };
  isDefault: boolean;
  onSelectDefault: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [methods, setMethods] = useState<AcpAuthMethodsResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // method id currently in-flight
  const [probeErr, setProbeErr] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);

  const openPicker = async () => {
    setPickerOpen(true);
    if (methods || probeErr) return; // already probed
    try {
      const r = await window.backchat.acpAuthMethods(agent.id);
      setMethods(r);
    } catch (e) {
      setProbeErr(e instanceof Error ? e.message : String(e));
    }
  };

  const runAuth = async (methodId: string) => {
    setBusy(methodId);
    setResultMsg(null);
    try {
      await window.backchat.acpAuthenticate(agent.id, methodId);
      setResultMsg({ kind: "ok", text: "登录成功" });
    } catch (e) {
      setResultMsg({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="space-y-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onSelectDefault}
          className={cn(
            "flex flex-1 items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
            isDefault
              ? "bg-bg-surface text-fg"
              : "bg-bg-surface/40 hover:bg-bg-surface text-fg",
          )}
        >
          {isDefault ? (
            <CheckCircle2Icon className="size-4 shrink-0 text-fg-muted" />
          ) : (
            <CircleIcon className="size-4 shrink-0 text-fg-subtle" />
          )}
          <span className="flex-1 truncate font-medium">{agent.label}</span>
          <span className="font-mono text-[11px] text-fg-subtle">{agent.id}</span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (pickerOpen ? setPickerOpen(false) : void openPicker())}
          className="text-fg-muted"
          title="登录 / 切换账号"
        >
          <KeyRoundIcon className="size-3.5" />
          <span className="ml-1 text-xs">登录</span>
        </Button>
      </div>
      {pickerOpen && (
        <div className="ml-6 rounded-md border border-border/60 bg-bg-surface/40 p-2 text-xs">
          {probeErr ? (
            <p className="text-danger">无法读取登录方式：{probeErr}</p>
          ) : !methods ? (
            <p className="flex items-center gap-2 text-fg-muted">
              <Loader2Icon className="size-3 animate-spin" />
              <span>读取登录方式…</span>
            </p>
          ) : methods.methods.length === 0 ? (
            <p className="text-fg-muted">这个 agent 不需要登录。</p>
          ) : (
            <ul className="space-y-1">
              {methods.methods.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => void runAuth(m.id)}
                    disabled={busy != null}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors",
                      "hover:bg-bg-surface text-fg",
                      busy != null && "opacity-50",
                    )}
                  >
                    {busy === m.id ? (
                      <Loader2Icon className="size-3 animate-spin text-fg-muted" />
                    ) : (
                      <KeyRoundIcon className="size-3 text-fg-subtle" />
                    )}
                    <span className="flex-1 truncate">{m.name}</span>
                    {m.description && (
                      <span className="truncate text-[11px] text-fg-subtle">
                        {m.description}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {resultMsg && (
            <p
              className={cn(
                "mt-2 text-[11px]",
                resultMsg.kind === "ok" ? "text-fg-muted" : "text-danger",
              )}
            >
              {resultMsg.text}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
