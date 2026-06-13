import { PairChatView } from "@/components/chat/PairChatView";

/**
 * /pair/$pairId page — multi-agent grid chat. PairChatView reads the
 * pair id via useParams; this wrapper just provides the route mount.
 */
export function PairChatPage() {
  return <PairChatView />;
}
