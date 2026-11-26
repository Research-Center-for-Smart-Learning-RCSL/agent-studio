import { wallClock } from "./logs-format";

export type ExportFormat = "xlsx" | "jsonl" | "parquet" | "pdf";
/** What the turn list exports to; PDF is for chosen conversations only. */
export const LIST_FORMATS: readonly ExportFormat[] = ["xlsx", "jsonl", "parquet"];
export const CONVERSATION_FORMATS: readonly ExportFormat[] = ["pdf", "xlsx", "jsonl", "parquet"];
/** The server's limit on conversations in one export. */
export const MAX_CONVERSATIONS = 200;

// A conversation's title as the server names a file by it (naming.py, clean_name and _title_part), so the
// choice shows the name the file gets: "" when nothing is left. The 150-byte cut and the Windows device
// prefix are left to the server; neither changes a title a person would type.
const UNSAFE = /[\\/:*?"<>|]/g;
const DOTS = /[.․﹒．]/g;
// Every language's marks: a title's own would claim what the file may not hold.
const MARKS = ["含筆記", "截斷", "with-notes", "truncated"];

const rstrip = (s: string, chars: string) => {
  let end = s.length;
  while (end > 0 && chars.includes(s[end - 1]!)) end--;
  return s.slice(0, end);
};
const strip = (s: string, chars: string) => {
  let start = 0;
  while (start < s.length && chars.includes(s[start]!)) start++;
  return rstrip(s.slice(start), chars);
};
const endMark = (s: string) => MARKS.find((m) => s.endsWith("_" + m));

export function titleAsName(title: string, format: string): string {
  const plain = [...title.normalize("NFC")].map((c) => (/\s/u.test(c) ? " " : c)).filter((c) => !/\p{C}/u.test(c)).join("");
  let s = strip(plain.replace(UNSAFE, "-").split(" ").filter(Boolean).join(" "), " .");
  while (s.toLowerCase().endsWith("." + format)) s = rstrip(s.slice(0, -format.length - 1), " .");
  s = rstrip(s.replace(DOTS, "-"), " ");
  for (let mark = endMark(s); mark; mark = endMark(s)) s = rstrip(s.slice(0, -mark.length - 1), " _-");
  return s;
}

/**
 * The name an export of one conversation gets when it is not named by a title (naming.py, suggested_name):
 * the kind, the agent and the first turn's time, e.g. "對話_點餐助理_2026-11-20-1100".
 * `startedAt` is the API's Taipei wall-clock time of the conversation's first turn.
 */
export function defaultConversationName(agent: string | null | undefined, startedAt: string | null | undefined, language: "zh-TW" | "en"): string {
  const kind = language === "en" ? "conversation" : "對話";
  const part = agent ? titleAsName(agent, "xlsx").replace(DOTS, "-").slice(0, 60).trim() : "";
  const when = startedAt ? `${startedAt.slice(0, 10)}-${startedAt.slice(11, 13)}${startedAt.slice(14, 16)}` : "";
  return titleAsName([kind, part, when].filter(Boolean).join("_"), "xlsx");
}

type Translate = (key: string, values?: unknown[]) => string;

const TIMES = new Set(["since", "until"]);

/**
 * An export filter in words, e.g. "機器人: R1, 執行環境: 實體機器人"; empty when it filters nothing.
 * `robotName` names the robot of a serial.
 */
export function describeFilter(filter: Record<string, unknown>, t: Translate, robotName: (serial: string) => string = (s) => s): string {
  const names: Record<string, string> = {
    q: t("關鍵字"), robot: t("機器人"), prompt: "Agent", status: t("狀態"), conversation: t("對話"), conversations: t("對話"),
    tag: t("標籤"), label: t("控制標記"), org: "Org", project: "Project", runtime: t("執行環境"), bookmarked: t("只看書籤"),
    since: t("起"), until: t("迄"), kind: t("語音種類"),
  };
  const statuses: Record<string, string> = { ok: t("成功"), failed: t("失敗"), no_response: t("無回應") };
  const runtimes: Record<string, string> = { robot: t("機器人"), web: t("網頁") };
  return Object.entries(filter)
    // The caller's own scope is applied by the server and is not something the person chose.
    .filter(([k, v]) => k !== "scope" && v !== undefined && v !== null && v !== "" && v !== false)
    .map(([k, v]) => {
      const name = names[k] ?? k;
      if (v === true) return name;
      if (TIMES.has(k) && typeof v === "string") return `${name}: ${wallClock(v)}`;
      // A count, never the ids: they are long, unbroken and tell a reader nothing.
      if (k === "conversations" && Array.isArray(v)) return `${name}: ${t("{0} 段", [v.length])}`;
      if (k === "status") return `${name}: ${statuses[String(v)] ?? String(v)}`;
      if (k === "runtime") return `${name}: ${runtimes[String(v)] ?? String(v)}`;
      if (k === "robot") return `${name}: ${robotName(String(v))}`;
      return `${name}: ${String(v)}`;
    })
    .join(", ");
}
