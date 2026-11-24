import { describe, expect, it } from "vitest";
import dictionary from "../src/lib/i18n-dictionary.json";
import { runtimeFunctionNames, runtimeFunctions } from "../src/lib/runtime-functions";

describe("runtime function catalog", () => {
  it("lists exactly the functions the backend executes", () => {
    expect([...runtimeFunctionNames].sort()).toEqual([
      "database_operation", "set_timeout", "upload_audio", "upload_file", "upload_image",
      "workspace_download", "workspace_list", "workspace_upload",
    ]);
  });

  it("offers each function as a well-formed tool named after it", () => {
    for (const { name, tool } of runtimeFunctions) {
      expect(tool).toMatchObject({ type: "function", name, parameters: { type: "object" } });
      expect(typeof tool.description).toBe("string");
    }
  });

  it("does not list functions the backend cannot run", () => {
    expect(runtimeFunctionNames.has("get_database_data")).toBe(false);
    expect(runtimeFunctionNames.has("get_storage_file")).toBe(false);
  });

  it("translates every description", () => {
    for (const { description } of runtimeFunctions) {
      for (const locale of ["en", "pl"] as const) {
        expect((dictionary[locale] as Record<string, string>)[description], description).toBeTruthy();
      }
    }
  });
});
