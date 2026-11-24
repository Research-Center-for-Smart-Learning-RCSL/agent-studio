import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { secrets } from "@/db/schema";
import { env } from "./env";
import { credentialGranted, mcpCredentialReferences, resolveMcpCredentialFields } from "./mcp-credentials";

function key(): Buffer {
  const k = Buffer.from(env.secretsKey, "base64");
  if (k.length !== 32) throw new Error("SECRETS_KEY must be 32 bytes, base64-encoded");
  return k;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(sealed: string): string {
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

async function authorizedToolSecrets(projectId: string, tools: Record<string, unknown>[]) {
  const fields = tools.flatMap(mcpCredentialReferences);
  if (!fields.length) return new Map<string, string>();
  const names = [...new Set(fields.map(({ name }) => name))];
  const rows = await db.select().from(secrets).where(inArray(secrets.name, names));
  const credentials = new Map(rows.map((row) => [row.name, row]));
  const authorized = new Map<string, string>();
  for (const reference of fields) {
    const row = credentials.get(reference.name);
    if (!row || !credentialGranted(row.grants, projectId, reference)) {
      throw new Error("MCP 憑證未授權給此專案、伺服器與欄位，請聯絡管理員");
    }
    authorized.set(reference.name, row.ciphertext);
  }
  return authorized;
}

export async function validateToolSecrets(projectId: string, tools: Record<string, unknown>[]) {
  await authorizedToolSecrets(projectId, tools);
}

export async function resolveToolSecrets(projectId: string, tools: Record<string, unknown>[]) {
  const authorized = await authorizedToolSecrets(projectId, tools);
  if (!authorized.size) return tools;
  const values = new Map([...authorized].map(([name, ciphertext]) => [name, decryptSecret(ciphertext)]));
  return resolveMcpCredentialFields(tools, values);
}
