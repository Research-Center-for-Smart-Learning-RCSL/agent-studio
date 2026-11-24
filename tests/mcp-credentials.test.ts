import { describe, expect, it } from "vitest";
import { credentialGranted, mcpCredentialReferences, resolveMcpCredentialFields } from "../src/lib/mcp-credentials";

const tool = {
  type: "mcp",
  server_url: "https://mcp.example.test/tools",
  server_description: "Leave {{secret:test}} in public descriptions untouched",
  authorization: "{{secret:test}}",
  headers: { "X-Service-Token": "Bearer {{secret:other}}", "not a header": "{{secret:test}}" },
};

describe("MCP credential grants", () => {
  it("requires the same project, server URL, and credential field", () => {
    const [reference] = mcpCredentialReferences(tool);
    const grants = [{ projectId: "proj_1", serverUrl: tool.server_url, field: "authorization" }];
    expect(credentialGranted(grants, "proj_1", reference)).toBe(true);
    expect(credentialGranted(grants, "proj_2", reference)).toBe(false);
    expect(credentialGranted(grants, "proj_1", { ...reference, serverUrl: "https://mcp.example.test/other" })).toBe(false);
    expect(credentialGranted(grants, "proj_1", { ...reference, field: "headers.authorization" })).toBe(false);
    expect(credentialGranted(grants, "proj_1", { ...reference, serverUrl: null })).toBe(false);
    const [connectorReference] = mcpCredentialReferences({ ...tool, connector_id: "connector_example" });
    expect(credentialGranted(grants, "proj_1", connectorReference)).toBe(false);
  });

  it("substitutes only recognized MCP credential fields", () => {
    const functionTool = { type: "function", description: "{{secret:test}}" };
    expect(mcpCredentialReferences(tool)).toEqual([
      { name: "test", field: "authorization", serverUrl: tool.server_url },
      { name: "other", field: "headers.x-service-token", serverUrl: tool.server_url },
    ]);
    expect(resolveMcpCredentialFields([tool, functionTool], new Map([["test", "credential"], ["other", "another"]]))).toEqual([
      { ...tool, authorization: "credential", headers: { ...tool.headers, "X-Service-Token": "Bearer another" } },
      functionTool,
    ]);
  });
});
