import {
  ChatConversation,
  ChatConversationContent,
  ChatConversationScrollButton,
  type ChatConversationContentProps,
  type ChatConversationProps,
  type ChatConversationScrollButtonProps,
} from "@openma/common/chat-ui";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Conversation = ChatConversation;
export const ConversationContent = ChatConversationContent;
export type ConversationProps = ChatConversationProps;
export type ConversationContentProps = ChatConversationContentProps;
export type ConversationScrollButtonProps = ChatConversationScrollButtonProps;

export const CHAT_SCROLL_BUTTON_CIRCLE_CLASS =
  "z-20 inline-flex size-8 items-center justify-center rounded-full border border-border-strong bg-bg text-fg-muted shadow-md transition-all hover:bg-bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ConversationScrollButton(
  props: ChatConversationScrollButtonProps,
) {
  const { t } = useI18n();
  return (
    <ChatConversationScrollButton
      {...props}
      renderButton={({ onClick, className, icon }) => (
        <Button
          aria-label={t("chat.scrollToBottom")}
          data-chat-scroll-to-bottom="true"
          className={cn(className, CHAT_SCROLL_BUTTON_CIRCLE_CLASS)}
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
