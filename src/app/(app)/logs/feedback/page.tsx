import { requireUser } from "@/lib/authz";
import { FeedbackView } from "../feedback-view";

export default async function FeedbackPage() {
  const user = await requireUser();
  return <FeedbackView isAdmin={user.isAdmin} />;
}
