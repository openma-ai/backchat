import {
  ChatConversation,
  ChatConversationContent,
  ChatConversationScrollButton,
  type ChatConversationContentProps,
  type ChatConversationProps,
  type ChatConversationScrollButtonProps,
} from "@openma/common/chat-ui";

import { Button } from "@/components/ui/button";

export const Conversation = ChatConversation;
export const ConversationContent = ChatConversationContent;
export type ConversationProps = ChatConversationProps;
export type ConversationContentProps = ChatConversationContentProps;
export type ConversationScrollButtonProps = ChatConversationScrollButtonProps;

export function ConversationScrollButton(
  props: ChatConversationScrollButtonProps,
) {
  return (
    <ChatConversationScrollButton
      {...props}
      renderButton={({ onClick, className, icon }) => (
        <Button
          className={className}
          onClick={onClick}
          size="icon"
          type="button"
          variant="outline"
        >
          {icon}
        </Button>
      )}
    />
  );
}
