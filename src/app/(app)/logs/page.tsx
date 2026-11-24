import { Suspense } from "react";
import { ConversationList } from "./conversation-list";

export default function LogsPage() {
  return (
    <Suspense>
      <ConversationList />
    </Suspense>
  );
}
