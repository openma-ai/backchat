import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  ElicitationFormRequestInfo,
  ElicitationQuestionInfo,
} from "../../../../shared/api.js";
import { InlineAskPanel } from "./ComposerAskPanel";
import {
  questionAnswerContent,
  type QuestionDraft,
} from "./ElicitationQuestionForm";

type FixtureCase = {
  name: string;
  request: "multi" | "planReview";
  drafts: Record<string, QuestionDraft>;
  content: Record<string, string | string[]>;
  answer: { answers: Array<{ id: string; selected: string[]; custom?: string }> };
};

const dshFixture = JSON.parse(readFileSync(
  new URL("../../../../main/__fixtures__/dsh-user-questions-elicitation.json", import.meta.url),
  "utf8",
)) as {
  normalizedRequests: {
    multi: ElicitationFormRequestInfo;
    planReview: ElicitationFormRequestInfo;
  };
  cases: FixtureCase[];
};

function normalizedQuestions(requestName: FixtureCase["request"]) {
  return dshFixture.normalizedRequests[requestName];
}

function draftsFor(
  questions: readonly ElicitationQuestionInfo[],
  labels: Record<string, QuestionDraft>,
): Record<string, QuestionDraft> {
  return Object.fromEntries(Object.entries(labels).map(([id, draft]) => {
    const question = questions.find((candidate) => candidate.id === id);
    if (!question) throw new Error(`missing question ${id}`);
    return [
      id,
      {
        selected: draft.selected.map((label) => {
          const option = question.options.find((candidate) => candidate.label === label);
          if (!option) throw new Error(`missing option ${label} for ${id}`);
          return option.value;
        }),
        custom: draft.custom,
      },
    ];
  }));
}

function renderAsk(form: ElicitationFormRequestInfo) {
  return renderToStaticMarkup(
    <InlineAskPanel
      ask={{
        kind: "elicitation",
        ask: {
          requestId: "req-dsh",
          sessionId: "sess-dsh",
          mode: "form",
          message: form.message,
          fields: form.fields,
          questions: form.questions,
        },
      }}
      onResolve={() => undefined}
    />,
  );
}

describe("dsh elicitation question content", () => {
  it.each(dshFixture.cases)("$name round-trips through dsh answer semantics", async (testCase) => {
    const form = await normalizedQuestions(testCase.request);
    const content = questionAnswerContent(
      form.questions!,
      draftsFor(form.questions!, testCase.drafts),
    );

    expect(content).toEqual(testCase.content);
  });

  it("returns null when any question remains unanswered", async () => {
    const form = await normalizedQuestions("multi");
    expect(questionAnswerContent(form.questions!, {})).toBeNull();
  });

  it("preserves dsh's ids and selected labels in fixture answers", () => {
    expect(dshFixture.cases.map(({ answer }) => answer.answers.map(({ id }) => id))).toEqual([
      ["target", "checks", "notes"],
      ["target", "checks", "notes"],
      ["target", "checks", "notes"],
      ["plan-review"],
      ["plan-review"],
    ]);
    expect(dshFixture.cases.map(({ answer }) =>
      answer.answers.map(({ selected }) => selected),
    )).toEqual([
      [["Staging"], ["Lint", "Unit tests"], []],
      [[], [], []],
      [["Local"], ["Typecheck"], []],
      [["Approve"]],
      [[]],
    ]);
  });
});

describe("dsh elicitation question rendering", () => {
  it("renders stacked questions with descriptions and multi-select checkboxes", async () => {
    const form = await normalizedQuestions("multi");
    const html = renderAsk(form);

    expect(html.match(/data-elicitation-question=/g)).toHaveLength(3);
    expect(html).toContain("Target");
    expect(html).toContain("Choose the deployment target.");
    expect(html).toContain("Run on this machine.");
    expect(html).toContain("Deploy to the shared staging cluster.");
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain("<select");
  });

  it("renders plan-review markdown and its options", async () => {
    const form = await normalizedQuestions("planReview");
    const html = renderAsk(form);

    expect(html).toContain('data-elicitation-form="plan-review"');
    expect(html).toMatch(/<h1[^>]*>Ship the release<\/h1>/);
    expect(html).toContain("Approve");
    expect(html).toContain("Keep planning");
    expect(html).toContain("Plan review");
  });

  it("renders a single-select question as described one-click rows", () => {
    const html = renderAsk({
      sessionId: "sess-dsh",
      message: "The agent needs your input.",
      fields: [
        {
          name: "question_0",
          type: "select",
          title: "Target",
          required: false,
          options: [
            { value: "option_0", label: "Local", description: "Run on this machine." },
            { value: "option_1", label: "Staging", description: "Deploy to staging." },
          ],
        },
        {
          name: "question_0_custom",
          type: "text",
          title: "Other",
          required: false,
        },
      ],
      questions: [{
        id: "target",
        question: "Where should this run?",
        header: "Target",
        detail: "Choose the deployment target.",
        multiSelect: false,
        field: "question_0",
        customField: "question_0_custom",
        options: [
          { value: "option_0", label: "Local", description: "Run on this machine." },
          { value: "option_1", label: "Staging", description: "Deploy to staging." },
        ],
      }],
    });

    expect(html).toContain('data-elicitation-form="questions"');
    expect(html).toContain('data-elicitation-choice="option_0"');
    expect(html).toContain("Run on this machine.");
    expect(html).toContain("Skip");
    expect(html).not.toContain("<select");
  });
});
