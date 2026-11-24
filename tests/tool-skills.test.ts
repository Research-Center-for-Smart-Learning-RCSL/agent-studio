import { describe, expect, it } from "vitest";
import { toolSkillId, toolSkills } from "../src/lib/tool-skills";

const shell = { type: "shell", environment: { type: "container_auto", memory_limit: "1g" }, allowed_callers: ["programmatic"] };

describe("toolSkills", () => {
  it("only applies to hosted shell tools in an automatic container", () => {
    expect(toolSkills({ type: "code_interpreter" })).toBeNull();
    expect(toolSkills({ type: "shell", environment: { type: "local" } })).toBeNull();
    expect(toolSkills({ type: "shell", environment: { type: "container_reference", container_id: "cntr_1" } })).toBeNull();
    expect(toolSkills({ type: "shell" })?.ids).toEqual([]);
    expect(toolSkills(shell)?.ids).toEqual([]);
  });

  it("adds references without touching other fields", () => {
    const result = toolSkills(shell)!.apply(["skill_a", "skill_b"]);
    expect(result).toEqual({
      ...shell,
      environment: {
        type: "container_auto", memory_limit: "1g",
        skills: [{ type: "skill_reference", skill_id: "skill_a" }, { type: "skill_reference", skill_id: "skill_b" }],
      },
    });
  });

  it("keeps pinned versions and entries that are not plain references", () => {
    const inline = { type: "inline", name: "x", description: "y", source: {} };
    const tool = {
      type: "shell",
      environment: { type: "container_auto", skills: [{ type: "skill_reference", skill_id: "skill_a", version: "2" }, inline] },
    };
    const skills = toolSkills(tool)!;
    expect(skills.ids).toEqual(["skill_a"]);
    expect((skills.apply(["skill_b", "skill_a"]).environment as { skills: unknown[] }).skills).toEqual([
      { type: "skill_reference", skill_id: "skill_b" },
      { type: "skill_reference", skill_id: "skill_a", version: "2" },
      inline,
    ]);
  });

  it("drops the skills field when the last reference is removed", () => {
    const tool = { type: "shell", environment: { type: "container_auto", skills: [{ type: "skill_reference", skill_id: "skill_a" }] } };
    expect(toolSkills(tool)!.apply([])).toEqual({ type: "shell", environment: { type: "container_auto" } });
  });

  it("accepts only OpenAI skill identifiers", () => {
    expect(toolSkillId.test("skill_6a994d4fb254819895a6a61138bca3660650489c6069ee10")).toBe(true);
    for (const bad of ["", "file-abc", "skill_", "skill_a b", "../skill_a"]) expect(toolSkillId.test(bad)).toBe(false);
  });
});
