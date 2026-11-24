import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError, searchIndexStatus, uploadToolFiles } from "../src/lib/openai-tool-files";

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

  it("reports a failed index without deleting resources", async () => {
    const upstream = vi.fn()
      .mockResolvedValueOnce(response({ status: "completed", file_counts: { failed: 1, completed: 0 } }));
    vi.stubGlobal("fetch", upstream);
    await expect(searchIndexStatus(access, "vs_bad")).resolves.toBe("failed");
    expect(upstream).toHaveBeenCalledExactlyOnceWith("https://api.openai.com/v1/vector_stores/vs_bad", expect.not.objectContaining({ method: "DELETE" }));
  });

  it("rolls back a failed store and its files when the same upload created both", async () => {
    const upstream = vi.fn()
      .mockResolvedValueOnce(response({ id: "file-new" }))
      .mockResolvedValueOnce(response({ id: "vs_new", status: "completed", file_counts: { failed: 1 } }))
      .mockResolvedValueOnce(response({ deleted: true }))
      .mockResolvedValueOnce(response({ deleted: true }));
    vi.stubGlobal("fetch", upstream);
    await expect(uploadToolFiles(access, [file("new.txt")], "search")).rejects.toThrow("OpenAI could not index the files");
    expect(upstream.mock.calls.filter(([, init]) => init?.method === "DELETE").map(([url]) => url)).toEqual([
      "https://api.openai.com/v1/vector_stores/vs_new",
      "https://api.openai.com/v1/files/file-new",
    ]);
  });

  it("leaves a store that is still indexing or ready alone", async () => {
    const upstream = vi.fn()
      .mockResolvedValueOnce(response({ status: "in_progress" }))
      .mockResolvedValueOnce(response({ status: "completed", file_counts: { completed: 1 } }));
    vi.stubGlobal("fetch", upstream);
    await expect(searchIndexStatus(access, "vs_a")).resolves.toBe("indexing");
    await expect(searchIndexStatus(access, "vs_b")).resolves.toBe("ready");
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("reports only the status, code, and type of a rejected call", async () => {
    const message = "Incorrect API key provided: sk-abc***xyz";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ error: { message, code: "invalid_api_key", type: "invalid_request_error" } }, { status: 401 }),
    ));
    const error = await searchIndexStatus(access, "vs_new").catch((issue: unknown) => issue);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ status: 401, code: "invalid_api_key", type: "invalid_request_error" });
    expect(JSON.stringify(error) + String((error as Error).message)).not.toContain("sk-abc");
  });

  it("leaves files whose project does not match untouched", async () => {
    const upstream = vi.fn()
      .mockResolvedValueOnce(response({ id: "file-stray" }, "proj_other"));
    vi.stubGlobal("fetch", upstream);
    await expect(uploadToolFiles(access, [file("one.txt")], "file")).rejects.toMatchObject({ code: "project_mismatch" });
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
