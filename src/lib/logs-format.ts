/** Pure helpers for showing Logs data; times are already Taipei wall-clock in the API. */

/** "2026-10-28T00:08:40.317+08:00" -> "2026-10-28 00:08:40", never re-zoned by the browser. */
export function wallClock(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 19).replace("T", " ") : "";
}

/** Milliseconds, switching to seconds from 10 s; "-" when unknown. */
export function durationText(ms: number | null): string {
  return ms == null ? "-" : ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

export function byteSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** A date input's "YYYY-MM-DD" as the start of that day in Taipei. */
export function taipeiDayStart(day: string): string {
  return `${day}T00:00:00+08:00`;
}

/** The day after a date input's value, as an exclusive upper bound. */
export function taipeiDayEnd(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)}T00:00:00+08:00`;
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export const logsPath = "/api/logs";
export const recordingUrl = (sha256: string) => `${logsPath}/v1/recordings/${encodeURIComponent(sha256)}`;
export const attachmentUrl = (sha256: string) => `${logsPath}/v1/attachments/${encodeURIComponent(sha256)}`;
export const remoteImageUrl = (url: string) => `${logsPath}/v1/remote-images?url=${encodeURIComponent(url)}`;

/** Raster formats only; SVG can carry script. */
export const SAFE_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const bareType = (mediaType: string | null): string => (mediaType ?? "").split(";")[0]!.trim().toLowerCase();

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]*$/;

export type ImageSource = { src: string; original?: string };

/**
 * How to embed a recorded image, or null to leave it as text. A web address is
 * never loaded from its own host: the image comes from the archive's kept copy.
 */
export function inlineImageSrc(value: unknown): ImageSource | null {
  if (typeof value !== "string") return null;
  if (DATA_IMAGE.test(value)) return { src: value };
  if (!isHttpUrl(value) || new URL(value).protocol !== "https:") return null;
  return { src: remoteImageUrl(value), original: value };
}

/** The image URL of a recorded media item: a string, or an object's url/image_url. */
export function imageOf(item: unknown): string | null {
  if (typeof item === "string") return item;
  if (typeof item === "object" && item !== null) {
    const o = item as Record<string, unknown>;
    for (const k of ["url", "image_url"]) if (typeof o[k] === "string") return o[k];
  }
  return null;
}

/** Entries of one media group: an object keyed by file id (replies) or an array (robot attachments). */
export function entriesOf(group: unknown): [string | null, unknown][] {
  if (Array.isArray(group)) return group.map((item) => [null, item]);
  if (typeof group === "object" && group !== null) return Object.entries(group);
  return [];
}

export function hasMedia(media: Record<string, unknown> | null): media is Record<string, unknown> {
  return media != null && Object.values(media).some((g) => entriesOf(g).length > 0);
}

// ![alt](url) or ![alt](<url> "title"). Everything else in the text stays text.
const MD_IMAGE = /!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g;

export type TextSegment = string | { alt: string; url: string; raw: string };

export function textSegments(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(MD_IMAGE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ alt: m[1]!, url: m[2]!.replace(/^<|>$/g, ""), raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function agentWhere(item: { org: string | null; project: string | null }): string {
  return [item.org, item.project].filter(Boolean).join(" / ");
}

const FOLD: Record<string, string> = { "（": "(", "）": ")", "“": '"', "”": '"', "「": '"', "」": '"' };

/**
 * The words a search looks for, for highlighting: operators are dropped, and so
 * is whatever NOT or a leading "-" excludes, a parenthesised group included.
 * Mirrors the Logs backend's search syntax loosely; it only decides what to mark.
 */
export function searchTerms(query: string): string[] {
  const folded = query.replace(/[（）“”「」]/g, (c) => FOLD[c] ?? c);
  const tokens = [...folded.matchAll(/"([^"]*)"|(-)(?=[("])|[()]|[^\s()"]+/g)].map((m) =>
    m[1] !== undefined ? { phrase: m[1] } : m[2] !== undefined ? { neg: true } : { word: m[0] });
  const terms: string[] = [];
  let skip = 0;
  let skipNext = false;
  for (const tok of tokens) {
    const word = "word" in tok ? tok.word : undefined;
    if (word === "(") { if (skip || skipNext) { skip += 1; skipNext = false; } continue; }
    if (word === ")") { if (skip) skip -= 1; continue; }
    if (skip) continue;
    if (word === "AND" || word === "OR") continue;
    if (word === "NOT" || "neg" in tok) { skipNext = true; continue; }
    if (skipNext) { skipNext = false; continue; }
    if (word?.startsWith("-") && word.length > 1) continue;
    const term = ("phrase" in tok ? tok.phrase ?? "" : word ?? "").replace(/\*+$/, "").trim();
    if (term) terms.push(term);
  }
  return terms;
}

/** Splits text into plain and matched parts for the given terms (case-insensitive); never builds HTML. */
export function highlightParts(text: string, terms: string[]): { text: string; match: boolean }[] {
  const wanted = terms.map((t) => t.toLowerCase()).filter(Boolean);
  if (wanted.length === 0) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const parts: { text: string; match: boolean }[] = [];
  let at = 0;
  while (at < text.length) {
    let best = -1;
    let bestLength = 0;
    for (const term of wanted) {
      const found = lower.indexOf(term, at);
      if (found !== -1 && (best === -1 || found < best || (found === best && term.length > bestLength))) {
        best = found;
        bestLength = term.length;
      }
    }
    if (best === -1) break;
    if (best > at) parts.push({ text: text.slice(at, best), match: false });
    parts.push({ text: text.slice(best, best + bestLength), match: true });
    at = best + bestLength;
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false });
  return parts;
}

export type ListFilters = { q: string; runtime: string; robot: string; bookmarked: string; since: string; until: string; status: string; kind: string };
export const emptyFilters: ListFilters = { q: "", runtime: "", robot: "", bookmarked: "", since: "", until: "", status: "", kind: "" };

const day = /^\d{4}-\d{2}-\d{2}$/;

/** The API query for the filters a list page holds; an unreadable date is left out rather than sent. */
export function filterParams(f: ListFilters): Record<string, string | boolean | undefined> {
  return {
    q: f.q.trim() || undefined,
    robot: f.robot.trim() || undefined,
    runtime: f.runtime === "web" || f.runtime === "robot" ? f.runtime : undefined,
    status: f.status === "ok" || f.status === "failed" || f.status === "no_response" ? f.status : undefined,
    kind: f.kind === "stt" || f.kind === "tts" ? f.kind : undefined,
    bookmarked: f.bookmarked === "1" ? true : undefined,
    since: day.test(f.since) ? taipeiDayStart(f.since) : undefined,
    until: day.test(f.until) ? taipeiDayEnd(f.until) : undefined,
  };
}

/** True when the start is after the end, which no turn can satisfy. */
export function badRange(f: ListFilters): boolean {
  return day.test(f.since) && day.test(f.until) && f.since > f.until;
}
