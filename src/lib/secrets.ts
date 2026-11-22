import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { secrets } from "@/db/schema";
import { env } from "./env";

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

/** Tool definitions reference credentials as `{{secret:NAME}}` inside any string value. */
export const SECRET_REF = /\{\{secret:([A-Za-z0-9_.-]+)\}\}/g;

export function secretNamesIn(value: unknown): Set<string> {
  const names = new Set<string>();
  for (const match of JSON.stringify(value ?? null).matchAll(SECRET_REF)) names.add(match[1]);
  return names;
}

/** Replace secret references with their values; unknown names throw. */
export async function resolveSecrets<T>(value: T): Promise<T> {
  const names = [...secretNamesIn(value)];
  if (!names.length) return value;
  const rows = await db.select().from(secrets).where(inArray(secrets.name, names));
  const values = new Map(rows.map((r) => [r.name, decryptSecret(r.ciphertext)]));
  const resolve = (v: unknown): unknown => {
    if (typeof v === "string") {
      return v.replace(SECRET_REF, (_, name: string) => {
        const secret = values.get(name);
        if (secret === undefined) throw new Error(`secret ${name} is not defined`);
        return secret;
      });
    }
    if (Array.isArray(v)) return v.map(resolve);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)]));
    }
    return v;
  };
  return resolve(value) as T;
}
