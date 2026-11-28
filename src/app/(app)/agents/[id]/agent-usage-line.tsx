import type { CurrentUser } from "@/lib/authz";
import { fetchAgentUsage } from "@/lib/logs";
import { UsageText } from "./usage-text";

/**
 * The agent's recent use, read from Logs. It renders inside a Suspense boundary so the editor never waits for Logs.
 * Logs attributes a turn to a project only through the agent lists it captured, so a non-administrator whose
 * count is zero may simply not be shown the turns; the line is left out rather than claim there was no use.
 */
export async function AgentUsageLine(props: { user: CurrentUser; agent: { id: string; projectId: string } }) {
  const usage = await fetchAgentUsage(props.user, props.agent);
  if (!usage) return null;
  if (usage.turns === 0 && !props.user.isAdmin) return null;
  return <UsageText usage={usage} />;
}
