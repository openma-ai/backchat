import { CLAUDE_AGENT_ACP_0_64_2_FIXTURE } from "./claude-agent-acp-0.64.2";
import { CODEX_ACP_1_1_9_FIXTURE } from "./codex-acp-1.1.9";
import { CURSOR_2026_07_23_FIXTURE } from "./cursor-2026.07.23";
import { KILO_7_4_20_FIXTURE } from "./kilo-7.4.20";
import { KIMI_1_49_0_FIXTURE } from "./kimi-1.49.0";
import { OPENCODE_1_18_13_FIXTURE } from "./opencode-1.18.13";
import { PI_ACP_0_0_33_FIXTURE } from "./pi-acp-0.0.33";

export {
  CLAUDE_AGENT_ACP_0_64_2_FIXTURE,
  CODEX_ACP_1_1_9_FIXTURE,
  CURSOR_2026_07_23_FIXTURE,
  KILO_7_4_20_FIXTURE,
  KIMI_1_49_0_FIXTURE,
  OPENCODE_1_18_13_FIXTURE,
  PI_ACP_0_0_33_FIXTURE,
};
export {
  HARNESS_COVERAGE_DIMENSIONS,
  type HarnessCoverage,
  type HarnessCoverageDimension,
  type HarnessCoverageEntry,
  type HarnessEvidence,
} from "./types";

export const HARNESS_EVENT_FIXTURES = [
  CLAUDE_AGENT_ACP_0_64_2_FIXTURE,
  CODEX_ACP_1_1_9_FIXTURE,
  CURSOR_2026_07_23_FIXTURE,
  PI_ACP_0_0_33_FIXTURE,
  OPENCODE_1_18_13_FIXTURE,
  KILO_7_4_20_FIXTURE,
  KIMI_1_49_0_FIXTURE,
] as const;
