import { useQuery } from "@tanstack/react-query";
import { AGENTS_QUERY_KEY } from "@/lib/agent-query";
import { useComposerHarnessLiveAuth } from "@/lib/composer-harness-live-auth";

/** Start the default harness live probe as soon as agent inventory is available. */
export function ComposerHarnessLiveAuthWarmup() {
  const { data: agents } = useQuery({
    queryKey: AGENTS_QUERY_KEY,
    staleTime: 60_000,
  });
  const defaultAgentId = agents?.[0]?.id ?? "";
  useComposerHarnessLiveAuth(defaultAgentId, defaultAgentId.length > 0);
  return null;
}
