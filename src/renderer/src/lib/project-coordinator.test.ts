import { expect, it } from "vitest";
import { defaultCoordinatorConfig } from "./project-coordinator";
import { resolveChatSubmitAgentId } from "./chat-submission";
it("allows a coordinator placeholder to submit the composer's selected harness", () => {
  expect(resolveChatSubmitAgentId({ target: { status: "ready", agent_id: "" }, selectedAgentId: "chosen" })).toBe("chosen");
  expect(defaultCoordinatorConfig("p")).toMatchObject({ projectId: "p", continuity: "per-scope", controls: ["delegate", "steer", "cancel", "complete"] });
});
