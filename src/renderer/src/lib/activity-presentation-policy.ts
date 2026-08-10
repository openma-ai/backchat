export interface ActivityPresentationPolicy {
  persistThoughtTimeline: boolean;
  groupToolsAcrossThoughts: boolean;
}

const CODEX_ACTIVITY_POLICY: ActivityPresentationPolicy = {
  // For Codex, thinking is a passing state and not part of the record: the
  // block shows what it is reasoning about now and is gone once it moves on.
  // That is not the same as dropping it, which is what this used to mean — the
  // block was never drawn at all and real reasoning, headed sections and
  // several paragraphs of it, was only ever squeezed into one truncated line.
  persistThoughtTimeline: false,
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
