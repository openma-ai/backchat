type DismissibleAsk =
  | {
      kind: "permission";
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
  const option =
    ask.ask.options.find((candidate) => candidate.kind.startsWith("reject_")) ??
    ask.ask.options[0];
  return { optionId: option?.optionId ?? null };
}
