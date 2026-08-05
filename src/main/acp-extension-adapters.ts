import {
  RequestError,
  type ClientCallbacks,
} from "@open-managed-agents-desktop/acp";

export interface HarnessExtensionRequestOptions {
  agentId: string;
  sessionId: string;
  requestPermission?: ClientCallbacks["requestPermission"];
}

export function extensionRequestHandlerForHarness(
  options: HarnessExtensionRequestOptions,
): ClientCallbacks["extensionRequest"] | undefined {
  const agentId = options.agentId.trim().toLowerCase();
  if (agentId !== "cursor" && agentId !== "cursor-acp") return undefined;

  return async (method, params) => {
    if (
      method === "cursor/task"
      || method === "cursor/update_todos"
      || method === "cursor/generate_image"
    ) {
      return {};
    }
    if (method === "cursor/ask_question") {
      return answerCursorQuestions(options, params);
    }
    if (method === "cursor/create_plan") {
      return reviewCursorPlan(options, params);
    }
    throw RequestError.methodNotFound(method);
  };
}

const CURSOR_DONE_OPTION = "__cursor_done__";
const CURSOR_SKIP_OPTION = "__cursor_skip__";

async function answerCursorQuestions(
  options: HarnessExtensionRequestOptions,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const requestPermission = options.requestPermission;
  if (!requestPermission) {
    throw RequestError.methodNotFound("cursor/ask_question");
  }
  const title = stringValue(params.title) ?? "Question";
  const toolCallId = stringValue(params.toolCallId) ?? "cursor-question";
  const questions = Array.isArray(params.questions) ? params.questions : [];
  const answers: Array<{
    questionId: string;
    selectedOptionIds: string[];
  }> = [];

  for (const value of questions) {
    const question = recordValue(value);
    const questionId = stringValue(question.id);
    const prompt = stringValue(question.prompt);
    if (!questionId || !prompt) continue;
    const choices = (Array.isArray(question.options) ? question.options : [])
      .flatMap((candidate) => {
        const choice = recordValue(candidate);
        const id = stringValue(choice.id);
        const label = stringValue(choice.label);
        return id && label ? [{ id, label }] : [];
      });
    if (choices.length === 0) continue;

    const selected: string[] = [];
    if (question.allowMultiple === true) {
      while (selected.length < choices.length) {
        const remaining = choices.filter((choice) => !selected.includes(choice.id));
        const response = await requestPermission({
          sessionId: options.sessionId,
          toolCall: {
            toolCallId: `${toolCallId}:${questionId}:${selected.length}`,
            title: `${title}: ${prompt}`,
            kind: "other",
            status: "pending",
            content: [{ type: "content", content: { type: "text", text: prompt } }],
          },
          options: [
            ...remaining.map((choice) => ({
              optionId: choice.id,
              name: choice.label,
              kind: "allow_once" as const,
            })),
            {
              optionId: CURSOR_DONE_OPTION,
              name: "Done selecting",
              kind: "reject_once" as const,
            },
          ],
        });
        const outcome = recordValue(response.outcome);
        if (outcome.outcome === "cancelled") {
          return { outcome: { outcome: "cancelled" } };
        }
        const optionId = stringValue(outcome.optionId);
        if (!optionId || optionId === CURSOR_DONE_OPTION) break;
        if (!remaining.some((choice) => choice.id === optionId)) {
          return {
            outcome: {
              outcome: "skipped",
              reason: "Client returned an unknown question option",
            },
          };
        }
        selected.push(optionId);
      }
    } else {
      const response = await requestPermission({
        sessionId: options.sessionId,
        toolCall: {
          toolCallId: `${toolCallId}:${questionId}`,
          title: `${title}: ${prompt}`,
          kind: "other",
          status: "pending",
          content: [{ type: "content", content: { type: "text", text: prompt } }],
        },
        options: [
          ...choices.map((choice) => ({
            optionId: choice.id,
            name: choice.label,
            kind: "allow_once" as const,
          })),
          {
            optionId: CURSOR_SKIP_OPTION,
            name: "Skip",
            kind: "reject_once" as const,
          },
        ],
      });
      const outcome = recordValue(response.outcome);
      if (outcome.outcome === "cancelled") {
        return { outcome: { outcome: "cancelled" } };
      }
      const optionId = stringValue(outcome.optionId);
      if (!optionId || optionId === CURSOR_SKIP_OPTION) {
        return {
          outcome: { outcome: "skipped", reason: "User skipped questions" },
        };
      }
      if (!choices.some((choice) => choice.id === optionId)) {
        return {
          outcome: {
            outcome: "skipped",
            reason: "Client returned an unknown question option",
          },
        };
      }
      selected.push(optionId);
    }
    answers.push({ questionId, selectedOptionIds: selected });
  }

  return answers.length > 0
    ? { outcome: { outcome: "answered", answers } }
    : { outcome: { outcome: "skipped", reason: "No supported questions" } };
}

async function reviewCursorPlan(
  options: HarnessExtensionRequestOptions,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const requestPermission = options.requestPermission;
  if (!requestPermission) {
    throw RequestError.methodNotFound("cursor/create_plan");
  }
  const name = stringValue(params.name) ?? "Proposed plan";
  const overview = stringValue(params.overview);
  const plan = stringValue(params.plan);
  const response = await requestPermission({
    sessionId: options.sessionId,
    toolCall: {
      toolCallId: stringValue(params.toolCallId) ?? "cursor-plan",
      title: `Review plan: ${name}`,
      kind: "think",
      status: "pending",
      content: [{
        type: "content",
        content: {
          type: "text",
          text: plan ?? overview ?? name,
        },
      }],
    },
    options: [
      { optionId: "accept", name: "Accept plan", kind: "allow_once" },
      { optionId: "reject", name: "Reject plan", kind: "reject_once" },
    ],
  });
  const outcome = recordValue(response.outcome);
  if (outcome.outcome === "cancelled") {
    return { outcome: { outcome: "cancelled" } };
  }
  return outcome.optionId === "accept"
    ? { outcome: { outcome: "accepted" } }
    : { outcome: { outcome: "rejected", reason: "User rejected plan" } };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
