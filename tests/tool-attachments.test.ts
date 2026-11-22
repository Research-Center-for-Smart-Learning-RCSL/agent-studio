import { describe, expect, it } from "vitest";
import { toResponsesRequest } from "../src/lib/openai-shape";
import { readToolJson, toolAttachments } from "../src/lib/tool-attachments";

describe("tool attachments", () => {
  it("preserves the Hosted Shell configuration when updating files", () => {
    const tool = {
      type: "shell",
      environment: {
        type: "container_auto",
        file_ids: ["file-original"],
        skills: [{ type: "skill_reference", skill_id: "skill_example" }],
        network_policy: { type: "disabled" },
      },
    };
    const attachments = toolAttachments(tool);
    expect(attachments?.refs).toEqual(["file-original"]);
    expect(attachments?.apply(["file-replacement"])).toEqual({
      ...tool,
      environment: { ...tool.environment, file_ids: ["file-replacement"] },
    });
    expect(tool.environment.file_ids).toEqual(["file-original"]);
  });

  it("sends code interpreter files and file-search stores on the Responses request", () => {
    const code = toolAttachments({ type: "code_interpreter", container: { type: "auto", memory_limit: "4g" } })!;
    const search = toolAttachments({ type: "file_search", max_num_results: 5 })!;
    const request = toResponsesRequest({
      model: "gpt-example",
      instructions: [],
      settings: {},
      tools: [code.apply(["file-example"]), search.apply(["vs_example"])],
    });
    expect(request.tools).toEqual([
      { type: "code_interpreter", container: { type: "auto", memory_limit: "4g", file_ids: ["file-example"] } },
      { type: "file_search", max_num_results: 5, vector_store_ids: ["vs_example"] },
    ]);
  });

  it("leaves fixed and local tools under JSON editing", () => {
    expect(toolAttachments({ type: "code_interpreter", container: "cntr_existing" })).toBeNull();
    expect(toolAttachments({ type: "shell", environment: { type: "local" } })).toBeNull();
    expect(() => readToolJson("[]")).toThrow();
  });
});
