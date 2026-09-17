type DismissibleAsk =
  | {
      kind: "permission";
      openmaResponse?: "runtime_permission";
      ask: {
        options: readonly {
          optionId: string;
          kind: string;
        }[];
      };
    }
  | {
      kind: "fsWrite";
    };

export type AskDismissal = {
  optionId: string | null;
  approve?: boolean;
};

export function resolveAskDismissal(ask: DismissibleAsk): AskDismissal {
  if (ask.kind === "fsWrite") {
    return { optionId: null, approve: false };
  }
  if (ask.openmaResponse === "runtime_permission") return { optionId: null };
  const option =
    ask.ask.options.find((candidate) => candidate.kind.startsWith("reject_")) ??
    ask.ask.options[0];
  return { optionId: option?.optionId ?? null };
}
