export {
  ChatReasoningContent as ReasoningContent,
  ChatReasoningTrigger as ReasoningTrigger,
  type ChatReasoningContentProps as ReasoningContentProps,
  type ChatReasoningProps as ReasoningProps,
  type ChatReasoningTriggerProps as ReasoningTriggerProps,
} from "@openma/common/chat-ui";

import {
  ChatReasoning,
  type ChatReasoningProps,
} from "@openma/common/chat-ui";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export const BACKCHAT_COLLAPSIBLE_PRIMITIVES = {
  Root: Collapsible,
  Trigger: CollapsibleTrigger,
  Content: CollapsibleContent,
};

export function Reasoning(props: ChatReasoningProps) {
  return (
    <ChatReasoning
      {...props}
      primitives={BACKCHAT_COLLAPSIBLE_PRIMITIVES}
    />
  );
}
