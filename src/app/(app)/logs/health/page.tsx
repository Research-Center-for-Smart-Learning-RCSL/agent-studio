import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authz";
import { CaptureHealth } from "../logs-admin-view";

export default async function HealthPage() {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  return <CaptureHealth />;
}
