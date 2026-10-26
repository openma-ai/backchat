import { useState, type FormEvent } from "react";
import { ArrowRightIcon, PencilIcon } from "@/components/Icons";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type {
  ElicitationFormAskInfo,
  ElicitationFormResponseInfo,
  ElicitationQuestionInfo,
} from "@shared/api.js";
import { StreamdownText, useMarkdownCwd } from "./ChatMarkdown";

export type QuestionDraft = { selected: string[]; custom: string };

export function questionAnswerContent(
  questions: readonly ElicitationQuestionInfo[],
  drafts: Readonly<Record<string, QuestionDraft | undefined>>,
): Record<string, string | string[]> | null {
  const content: Record<string, string | string[]> = {};

  for (const question of questions) {
    const draft = drafts[question.id];
    const custom = draft?.custom.trim() ?? "";
    if (question.options.length === 0) {
      if (!custom) return null;
      content[question.field] = custom;
      continue;
    }

    if (!question.multiSelect) {
      if (custom && question.customField) {
        content[question.customField] = custom;
      } else if (draft?.selected[0]) {
        content[question.field] = draft.selected[0];
      } else {
        return null;
      }
      continue;
    }

    const selected = question.options
      .filter((option) => draft?.selected.includes(option.value))
      .map((option) => option.value);
    const hasCustomAnswer = Boolean(question.customField && custom);
    if (selected.length === 0 && !hasCustomAnswer) return null;
    if (selected.length > 0) content[question.field] = selected;
    if (custom && question.customField) content[question.customField] = custom;
  }

  return content;
}

export function ElicitationQuestionForm({
  ask,
  onSubmit,
}: {
  ask: ElicitationFormAskInfo;
  onSubmit: (response: ElicitationFormResponseInfo) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const cwd = useMarkdownCwd();
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft | undefined>>({});
  const questions = ask.questions ?? [];
  const planReview = questions.length === 1
    && questions[0]?.intent?.kind === "plan-review"
    ? questions[0]
    : undefined;
  const singleChoice = questions.length === 1
    && questions[0]?.options.length
    && !questions[0].multiSelect
    && !questions[0].intent
    ? questions[0]
    : undefined;

  const accept = (content: Record<string, string | string[]> | null) => {
    if (content) void onSubmit({ action: "accept", content });
  };
  const updateDraft = (question: ElicitationQuestionInfo, update: Partial<QuestionDraft>) => {
    setDrafts((current) => ({
      ...current,
      [question.id]: {
        selected: current[question.id]?.selected ?? [],
        custom: current[question.id]?.custom ?? "",
        ...update,
      },
    }));
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    accept(questionAnswerContent(questions, drafts));
  };

  if (planReview) {
    const draft = drafts[planReview.id] ?? { selected: [], custom: "" };
    const approveOption = planReview.options.find(
      (option) => option.label === planReview.intent?.approve,
    );
    return (
      <form
        className="min-w-0 space-y-3"
        data-elicitation-form="plan-review"
        onSubmit={(event) => {
          event.preventDefault();
          const content = planReview.customField && draft.custom.trim()
            ? { [planReview.customField]: draft.custom.trim() }
            : null;
          accept(content);
        }}
      >
        {planReview.detail && (
          <div className="max-h-[36vh] overflow-auto rounded-xl bg-bg/45 px-3 py-2.5">
            <StreamdownText
              text={planReview.detail}
              cwd={cwd}
              sessionId={ask.sessionId}
              surfacePrefix="elicitation-plan-review"
              className="chat-markdown text-xs leading-5 text-fg"
            />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {planReview.options.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={option === approveOption ? "default" : "outline"}
              data-elicitation-choice={option.value}
              onClick={() => accept({ [planReview.field]: option.value })}
            >
              {option.label}
            </Button>
          ))}
        </div>
        {planReview.customField && (
          <div
            data-elicitation-other={planReview.customField}
            className="flex items-center gap-2 rounded-xl bg-bg/45 px-3 py-2 transition-colors focus-within:bg-bg/75"
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t("ask.planFeedback")}</span>
              <input
                name={planReview.customField}
                value={draft.custom}
                placeholder={t("ask.planFeedback")}
                onChange={(event) => updateDraft(planReview, { custom: event.currentTarget.value })}
                className="h-7 w-full bg-transparent text-sm text-fg outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={!draft.custom.trim()}
              aria-label={t("ask.submit")}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-bg disabled:text-fg-disabled"
            >
              <ArrowRightIcon className="size-4" />
            </button>
          </div>
        )}
      </form>
    );
  }

  if (singleChoice) {
    const draft = drafts[singleChoice.id] ?? { selected: [], custom: "" };
    return (
      <form className="min-w-0" data-elicitation-form="questions" onSubmit={submit}>
        <QuestionHeading question={singleChoice} />
        <div className="max-h-[40vh] space-y-1.5 overflow-auto py-1">
          {singleChoice.options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              data-elicitation-choice={option.value}
              className="group flex w-full items-center gap-3 rounded-xl bg-bg/45 px-3 py-2.5 text-left transition-colors hover:bg-bg/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={() => accept(questionAnswerContent(questions, {
                ...drafts,
                [singleChoice.id]: { ...draft, selected: [option.value] },
              }))}
            >
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border/70 text-xs tabular-nums text-fg-muted">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg">{option.label}</span>
                {option.description && (
                  <span className="block text-[11px] leading-4 text-fg-muted">
                    {option.description}
                  </span>
                )}
              </span>
              <ArrowRightIcon className="size-4 shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
          ))}
          {singleChoice.customField && (
            <OtherInput
              customField={singleChoice.customField}
              value={draft.custom}
              placeholder={t("ask.other")}
              onChange={(custom) => updateDraft(singleChoice, { custom })}
              onSubmit={() => accept(questionAnswerContent(questions, {
                ...drafts,
                [singleChoice.id]: draft,
              }))}
            />
          )}
        </div>
        <div className="flex justify-end pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => void onSubmit({ action: "decline" })}
          >
            {t("ask.skip")}
          </Button>
        </div>
      </form>
    );
  }

  const content = questionAnswerContent(questions, drafts);
  return (
    <form className="min-w-0" data-elicitation-form="questions" onSubmit={submit}>
      <div className="max-h-[44vh] space-y-4 overflow-auto py-1">
        {questions.map((question) => {
          const draft = drafts[question.id] ?? { selected: [], custom: "" };
          return (
            <section
              key={question.id}
              data-elicitation-question={question.id}
              className="space-y-2"
            >
              <QuestionHeading question={question} />
              {question.options.length > 0 && !question.multiSelect ? (
                <div role="radiogroup" aria-label={question.question} className="space-y-1">
                  {question.options.map((option) => {
                    const checked = draft.selected.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        data-elicitation-choice={option.value}
                        className="flex w-full items-center gap-3 rounded-xl bg-bg/45 px-3 py-2 text-left text-xs text-fg transition-colors hover:bg-bg/75 aria-checked:bg-fg/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        onClick={() => updateDraft(question, { selected: [option.value] })}
                      >
                        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-border/70">
                          {checked && <span className="size-2 rounded-full bg-fg" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block">{option.label}</span>
                          {option.description && (
                            <span className="block text-[11px] leading-4 text-fg-muted">
                              {option.description}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : question.options.length > 0 ? (
                <div className="space-y-1">
                  {question.options.map((option) => (
                    <label
                      key={option.value}
                      data-elicitation-choice={option.value}
                      className="flex items-start gap-3 rounded-xl bg-bg/45 px-3 py-2 text-xs text-fg transition-colors hover:bg-bg/75"
                    >
                      <input
                        type="checkbox"
                        name={question.field}
                        value={option.value}
                        checked={draft.selected.includes(option.value)}
                        onChange={(event) => updateDraft(question, {
                          selected: event.currentTarget.checked
                            ? [...draft.selected, option.value]
                            : draft.selected.filter((value) => value !== option.value),
                        })}
                        className="mt-0.5 accent-fg"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block">{option.label}</span>
                        {option.description && (
                          <span className="block text-[11px] leading-4 text-fg-muted">
                            {option.description}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
              {question.options.length === 0 ? (
                <div
                  data-elicitation-other={question.field}
                  className="rounded-xl bg-bg/45 px-3 py-2 transition-colors focus-within:bg-bg/75"
                >
                  <input
                    name={question.field}
                    value={draft.custom}
                    placeholder={question.question}
                    onChange={(event) => updateDraft(question, { custom: event.currentTarget.value })}
                    className="h-7 w-full bg-transparent text-xs text-fg outline-none"
                  />
                </div>
              ) : question.customField ? (
                <div
                  data-elicitation-other={question.customField}
                  className="flex items-center gap-2 rounded-xl bg-bg/45 px-3 py-2 transition-colors focus-within:bg-bg/75"
                >
                  <PencilIcon className="size-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
                  <input
                    name={question.customField}
                    value={draft.custom}
                    placeholder={t("ask.other")}
                    onChange={(event) => updateDraft(question, { custom: event.currentTarget.value })}
                    className="h-6 min-w-0 flex-1 bg-transparent text-xs text-fg outline-none"
                  />
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 pt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void onSubmit({ action: "decline" })}
        >
          {t("ask.skip")}
        </Button>
        <Button type="submit" size="sm" disabled={!content}>
          {t("ask.submit")}
        </Button>
      </div>
    </form>
  );
}

function QuestionHeading({ question }: { question: ElicitationQuestionInfo }) {
  return (
    <div className="space-y-1.5 px-2">
      {question.header && (
        <span className="inline-flex rounded-md bg-bg/65 px-1.5 py-0.5 text-[10px] font-medium text-fg-subtle">
          {question.header}
        </span>
      )}
      <p className="text-sm font-medium leading-5 text-fg">{question.question}</p>
      {question.detail && (
        <p className="whitespace-pre-wrap text-xs leading-5 text-fg-muted">
          {question.detail}
        </p>
      )}
    </div>
  );
}

function OtherInput({
  customField,
  value,
  placeholder,
  onChange,
  onSubmit,
}: {
  customField: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div
      data-elicitation-other={customField}
      className="group flex w-full items-center gap-3 rounded-xl bg-bg/45 px-3 py-2.5 transition-colors focus-within:bg-bg/75"
    >
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border/70 text-fg-muted">
        <PencilIcon className="size-3.5" aria-hidden="true" />
      </span>
      <label className="min-w-0 flex-1">
        <span className="sr-only">{placeholder}</span>
        <input
          name={customField}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="h-6 w-full bg-transparent text-sm font-medium text-fg outline-none"
        />
      </label>
      <button
        type="button"
        disabled={!value.trim()}
        aria-label={placeholder}
        onClick={onSubmit}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-bg disabled:text-fg-disabled"
      >
        <ArrowRightIcon className="size-4" />
      </button>
    </div>
  );
}
