import { AgentUIStreamingThoughtProjection } from "@openma/common/agent-ui/react";

import { sessionStore } from "@/lib/session-store";

export { thoughtProjectionLines } from "@openma/common/agent-ui/react";

export function StreamingThoughtProjection(props: {
  turnId: string;
  prefixSkip: number;
  fallback: string;
  mode: "body" | "headline";
}) {
  return <AgentUIStreamingThoughtProjection store={sessionStore} {...props} />;
}
