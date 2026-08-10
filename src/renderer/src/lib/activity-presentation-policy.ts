export interface ActivityPresentationPolicy {
  persistThoughtTimeline: boolean;
  groupToolsAcrossThoughts: boolean;
}

const CODEX_ACTIVITY_POLICY: ActivityPresentationPolicy = {
  // Codex sends real reasoning — headed sections, several paragraphs — and this
  // was false, so all of it was only ever squeezed into one truncated status
  // line. The block itself was never rendered at all.
  persistThoughtTimeline: true,
  groupToolsAcrossThoughts: true,
};

const DEFAULT_ACTIVITY_POLICY: ActivityPresentationPolicy = {
  persistThoughtTimeline: true,
  groupToolsAcrossThoughts: false,
};

export function activityPresentationPolicy(
  agentId?: string,
): ActivityPresentationPolicy {
  switch (agentId) {
    case "codex-acp":
      return CODEX_ACTIVITY_POLICY;
    default:
      return DEFAULT_ACTIVITY_POLICY;
  }
}
