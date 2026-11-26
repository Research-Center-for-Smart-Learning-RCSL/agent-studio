import { Suspense } from "react";
import { ConversationsSplit } from "../list-splits";

export default function ConversationsLayout({ children }: LayoutProps<"/logs">) {
  return (
    <Suspense>
      <ConversationsSplit>{children}</ConversationsSplit>
    </Suspense>
  );
}
