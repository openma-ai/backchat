import { useQuery } from "@tanstack/react-query";
import { CheckCircle2Icon, CircleIcon, ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSettings, patchSettings } from "@/lib/settings-store";

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
    queryFn: () => window.openma.agentsList(),
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
        <h2 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
          Default agent ({detected.length} detected)
        </h2>
        {detected.length === 0 ? (
          <p className="rounded-md bg-warning-subtle p-3 text-xs text-fg">
            No ACP agents detected. Install one (see below) and restart the app.
          </p>
        ) : (
          <ul className="space-y-1">
            {detected.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setDefault(a.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                    defaultId === a.id
                      ? "bg-brand-subtle/50 text-fg"
                      : "bg-bg-surface/40 hover:bg-bg-surface text-fg",
                  )}
                >
                  {defaultId === a.id ? (
                    <CheckCircle2Icon className="size-4 shrink-0 text-brand" />
                  ) : (
                    <CircleIcon className="size-4 shrink-0 text-fg-subtle" />
                  )}
                  <span className="flex-1 truncate font-medium">{a.label}</span>
                  <span className="font-mono text-[10px] text-fg-subtle">{a.id}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {undetected.length > 0 && (
        <details className="group">
          {/* Collapsed by default — the registry has ~30 agents, most of
              which the user will never install. The few they have are
              what matters, and they live in the section above. */}
          <summary className="cursor-pointer list-none text-[10px] font-medium uppercase tracking-wider text-fg-subtle hover:text-fg-muted">
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
                  <Badge variant="secondary" className="font-mono text-[10px]">
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
