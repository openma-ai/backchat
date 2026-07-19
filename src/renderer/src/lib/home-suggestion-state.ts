import { useEffect, useReducer } from "react";

import {
  transitionHomeSuggestionPhase,
  type ComposerSuggestionDraft,
  type HomeSuggestionKind,
  type HomeSuggestionOption,
  type HomeSuggestionPhase,
  type HomeSuggestionTemplate,
} from "./home-suggestion-flow";

export interface HomeSuggestionSelection {
  kind: HomeSuggestionKind;
  label: string;
}

export interface HomeSuggestionState {
  phase: HomeSuggestionPhase;
  selection: HomeSuggestionSelection | null;
  selectedPrompt: string | null;
  draft: ComposerSuggestionDraft | null;
}

export type HomeSuggestionStateAction =
  | { type: "select"; selection: HomeSuggestionSelection }
  | { type: "fill-prefix"; id: number; text: string }
  | {
      type: "template-selected";
      id: number;
      slotLabel: string;
      template: HomeSuggestionTemplate;
    }
  | { type: "user-input"; hasContent: boolean }
  | { type: "back" }
  | { type: "consume" }
  | { type: "reset" };

export const initialHomeSuggestionState: HomeSuggestionState = {
  phase: "visible",
  selection: null,
  selectedPrompt: null,
  draft: null,
};

export function reduceHomeSuggestionState(
  state: HomeSuggestionState,
  action: HomeSuggestionStateAction,
): HomeSuggestionState {
  switch (action.type) {
    case "select":
      return {
        ...state,
        phase: transitionHomeSuggestionPhase(state.phase, "select"),
        selection: action.selection,
        selectedPrompt: null,
      };
    case "fill-prefix":
      return {
        ...state,
        draft: { id: action.id, text: action.text },
      };
    case "template-selected":
      return {
        phase: transitionHomeSuggestionPhase(
          state.phase,
          "template-selected",
        ),
        selection: null,
        selectedPrompt: action.slotLabel,
        draft: {
          id: action.id,
          text: "",
          template: action.template,
        },
      };
    case "user-input":
      return {
        ...state,
        phase: transitionHomeSuggestionPhase(
          state.phase,
          action.hasContent ? "user-input" : "user-clear",
        ),
        selection: null,
        selectedPrompt: null,
      };
    case "back":
      return {
        ...state,
        phase: transitionHomeSuggestionPhase(state.phase, "back"),
        selection: null,
        selectedPrompt: null,
      };
    case "consume":
      return { ...state, draft: null };
    case "reset":
      return {
        ...state,
        phase: transitionHomeSuggestionPhase(state.phase, "reset"),
        selection: null,
        selectedPrompt: null,
      };
  }
}

export function useHomeSuggestionState(
  activeSessionId: string | undefined,
) {
  const [state, dispatch] = useReducer(
    reduceHomeSuggestionState,
    initialHomeSuggestionState,
  );

  useEffect(() => {
    dispatch({ type: "reset" });
  }, [activeSessionId]);

  return {
    ...state,
    back: () => dispatch({ type: "back" }),
    consumeDraft: () => dispatch({ type: "consume" }),
    fillPrefix: (text: string) =>
      dispatch({ type: "fill-prefix", id: Date.now(), text }),
    selectSuggestion: (selection: HomeSuggestionSelection) =>
      dispatch({ type: "select", selection }),
    selectTemplate: (option: HomeSuggestionOption) =>
      dispatch({
        type: "template-selected",
        id: Date.now(),
        slotLabel: option.slotLabel,
        template: option.template,
      }),
    syncForUserInput: (hasContent: boolean) =>
      dispatch({ type: "user-input", hasContent }),
  };
}
