import { Suspense } from "react";
import { ConversationView } from "../../conversation-view";

/** A turn's conversation, opened beside the turn list; `turn` in the query is the turn to show. */
export default async function TurnConversationPage({ params }: PageProps<"/logs/turns/[id]">) {
  const { id } = await params;
  return (
    <Suspense>
      <ConversationView key={id} id={decodeURIComponent(id)} listPath="/logs/turns" />
    </Suspense>
  );
}
