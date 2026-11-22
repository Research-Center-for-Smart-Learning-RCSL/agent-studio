import { afterEach, describe, expect, it, vi } from "vitest";
import { searchIndexStatus, uploadToolFiles } from "../src/lib/openai-tool-files";

vi.mock("server-only", () => ({}));

const access = { projectId: "proj_example", key: "test-only" };
const file = (name: string) => new File(["attachment"], name);
const response = (data: unknown, projectId = access.projectId) =>
  Response.json(data, { headers: { "openai-project": projectId } });

afterEach(() => vi.unstubAllGlobals());

describe("OpenAI tool uploads", () => {
  it("creates a separate search store from a batch and reports indexing before readiness", async () => {
    const upstream = vi.fn()
      .mockResolvedValueOnce(response({ id: "file-one" }))
      .mockResolvedValueOnce(response({ id: "file-two" }))
      .mockResolvedValueOnce(response({ id: "vs_new", status: "in_progress" }))
      .mockResolvedValueOnce(response({ status: "completed", file_counts: { completed: 2, failed: 0 } }));
    vi.stubGlobal("fetch", upstream);

    const result = await uploadToolFiles(access, [file("one.txt"), file("two.txt")], "search");
    expect(result).toEqual({ attachments: [{ id: "vs_new", names: ["one.txt", "two.txt"] }], status: "indexing" });
    expect(upstream.mock.calls[0][1].body.get("purpose")).toBe("assistants");
    expect(upstream.mock.calls[2][0]).toBe("https://api.openai.com/v1/vector_stores");
    expect(JSON.parse(upstream.mock.calls[2][1].body).file_ids).toEqual(["file-one", "file-two"]);
    expect(upstream.mock.calls[2][1].headers.get("OpenAI-Project")).toBe(access.projectId);
    await expect(searchIndexStatus(access, "vs_new")).resolves.toBe("ready");
  });

  it("cleans up only files created by a failed batch", async () => {
    const upstream = vi.fn()
      .mockResolvedValueOnce(response({ id: "file-one" }))
      .mockResolvedValueOnce(Response.json({}, { status: 403 }))
      .mockResolvedValueOnce(response({ deleted: true }));
    vi.stubGlobal("fetch", upstream);
    await expect(uploadToolFiles(access, [file("one.txt"), file("two.txt")], "search")).rejects.toThrow();
    expect(upstream.mock.calls[2][0]).toBe("https://api.openai.com/v1/files/file-one");
    expect(upstream.mock.calls[2][1].method).toBe("DELETE");
  });

  it("treats a provider project mismatch and partial index failure as unusable", async () => {
    const upstream = vi.fn()
      .mockResolvedValueOnce(response({ status: "completed", file_counts: { failed: 1, completed: 1 } }))
      .mockResolvedValueOnce(response({ status: "completed" }, "proj_other"));
    vi.stubGlobal("fetch", upstream);
    await expect(searchIndexStatus(access, "vs_new")).resolves.toBe("failed");
    await expect(searchIndexStatus(access, "vs_new")).rejects.toThrow("project file request");
  });
});
