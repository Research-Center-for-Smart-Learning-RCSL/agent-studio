import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authz";
import { AnalyticsView } from "../analytics-view";

export default async function AnalyticsPage() {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  return <AnalyticsView />;
}
