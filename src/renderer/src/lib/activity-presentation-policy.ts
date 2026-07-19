export interface ActivityPresentationPolicy {
  persistThoughtTimeline: boolean;
  showLatestThoughtStatus: boolean;
  groupToolsAcrossThoughts: boolean;
}

const CODEX_ACTIVITY_POLICY: ActivityPresentationPolicy = {
  persistThoughtTimeline: false,
  showLatestThoughtStatus: true,
  groupToolsAcrossThoughts: true,
};

const DEFAULT_ACTIVITY_POLICY: ActivityPresentationPolicy = {
  persistThoughtTimeline: true,
  showLatestThoughtStatus: false,
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
