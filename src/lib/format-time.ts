const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

const two = (n: number) => String(n).padStart(2, "0");

/**
 * A timestamp as Taipei wall-clock time, built by hand: Intl and toLocaleString differ between the server's
 * ICU and the browser's (a thin space for a space), and a mismatch fails hydration (React error 418).
 */
export function formatTaipei(value: string | number | Date, locale: string, withSeconds = true): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const t = new Date(date.getTime() + TAIPEI_OFFSET_MS);
  const sep = locale === "zh-Hant" ? "/" : "-";
  const day = `${t.getUTCFullYear()}${sep}${two(t.getUTCMonth() + 1)}${sep}${two(t.getUTCDate())}`;
  const clock = `${two(t.getUTCHours())}:${two(t.getUTCMinutes())}${withSeconds ? `:${two(t.getUTCSeconds())}` : ""}`;
  return `${day} ${clock}`;
}
