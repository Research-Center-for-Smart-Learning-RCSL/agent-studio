type Tool = Record<string, unknown>;

export const toolSkillId = /^skill_[A-Za-z0-9_-]+$/;
export const maxToolSkills = 20;

function isObject(value: unknown): value is Tool {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Skill references of a hosted shell tool that runs in an automatic container.
 * Other tools, and shells with a different environment, take no skills here.
 */
export function toolSkills(tool: Tool) {
  if (tool.type !== "shell") return null;
  const environment = tool.environment == null ? { type: "container_auto" } : tool.environment;
  if (!isObject(environment) || environment.type !== "container_auto") return null;
  const entries = Array.isArray(environment.skills) ? environment.skills : [];
  const references = entries.filter((entry): entry is Tool => isObject(entry) && entry.type === "skill_reference" && typeof entry.skill_id === "string");
  return {
    ids: references.map((entry) => entry.skill_id as string),
    // Any entry that is not a plain reference (for example an inline skill) must survive a selection change untouched.
    apply: (ids: string[]) => {
      const kept = entries.filter((entry) => !(isObject(entry) && entry.type === "skill_reference" && typeof entry.skill_id === "string"));
      const next = ids.map((id) => references.find((entry) => entry.skill_id === id) ?? { type: "skill_reference", skill_id: id });
      const skills = [...next, ...kept];
      const rest = Object.fromEntries(Object.entries(environment).filter(([key]) => key !== "skills"));
      return { ...tool, environment: skills.length ? { ...rest, skills } : rest };
    },
  };
}
