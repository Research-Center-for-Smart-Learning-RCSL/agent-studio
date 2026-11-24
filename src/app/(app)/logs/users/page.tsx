import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authz";
import { LogsUsers } from "../logs-admin-view";

export default async function UsersPage() {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  return <LogsUsers />;
}
