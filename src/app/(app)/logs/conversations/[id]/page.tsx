import { Suspense } from "react";
import { ConversationView } from "../../conversation-view";

export default async function ConversationPage({ params }: PageProps<"/logs/conversations/[id]">) {
  const { id } = await params;
  return (
    <Suspense>
      <ConversationView key={id} id={decodeURIComponent(id)} />
    </Suspense>
  );
}
