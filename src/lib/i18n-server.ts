import "server-only";
import { cookies } from "next/headers";
import { parseLocale, translate } from "./i18n";
export async function getLocale() { return parseLocale((await cookies()).get("studio-locale")?.value); }
export async function getTranslator() {
  const locale = await getLocale();
  return (key: string, values?: unknown[]) => translate(locale, key, values);
}
