import { getTranslator } from "@/lib/i18n-server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { diffLines } from "diff";
import { getAgent, getVersion, listVersions } from "@/lib/agents";
import { can, requireUser } from "@/lib/authz";
import { CompareControls } from "./compare-controls";

function instructionsText(messages: { role: string; content: unknown }[]) {
  const multi = messages.length > 1;
  return messages
    .map((m) => (multi ? `[${m.role}]\n` : "") + (typeof m.content === "string" ? m.content : JSON.stringify(m.content, null, 2)))
    .join("\n\n");
}

function Diff(props: { title: string; a: string; b: string ; t: Awaited<ReturnType<typeof getTranslator>>}) {
  const t = props.t;
  const parts = diffLines(props.a, props.b);
  const changed = parts.some((p) => p.added || p.removed);
  return (
    <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, marginBottom: 16 }}>
      <h3 style={{ margin: 0, padding: "10px 12px", borderBottom: "1px solid #e5e7eb", fontSize: 15 }}>
        {props.title} {!changed && <span style={{ color: "#526473", fontWeight: 400 }}>{t("（相同）")}</span>}
      </h3>
      {changed && (
        <div style={{ padding: "6px 0", maxHeight: "70vh", overflow: "auto" }}>
          {parts.map((p, i) => {
            const lines = p.value.replace(/\n$/, "").split("\n");
            // Collapse long unchanged stretches to their edges.
            const shown =
              !p.added && !p.removed && lines.length > 8
                ? [...lines.slice(0, 3), t("… 省略 {0} 行未變更 …", [lines.length - 6]), ...lines.slice(-3)]
                : lines;
            const cls = p.added ? "diff-add" : p.removed ? "diff-del" : "diff-ctx";
            const mark = p.added ? "+ " : p.removed ? "- " : "  ";
            return shown.map((line, j) => (
              <div key={`${i}-${j}`} className={`diff-line ${cls}`}>
                {mark}
                {line}
              </div>
            ));
          })}
        </div>
      )}
    </section>
  );
}

export default async function ComparePage(props: PageProps<"/agents/[id]/compare">) {
  const t = await getTranslator();
  const user = await requireUser();
  const { id } = await props.params;
  const q = await props.searchParams;
  const found = await getAgent(id);
  if (!found || !can(user, found.agent.projectId, "viewer")) notFound();
  const versions = await listVersions(id);
  const a = await getVersion(id, Number(q.a));
  const b = await getVersion(id, Number(q.b));

  return (
    <div>
      <p>
        <Link href={`/agents/${id}`}>← {found.agent.name}</Link>
      </p>
      <CompareControls agentId={id} versions={versions.map((v) => v.version)} a={a?.version ?? null} b={b?.version ?? null} />
      {!a || !b ? (
        <p>{t("請選擇兩個版本。")}</p>
      ) : (
        <>
          <Diff t={t} title={t("模型")} a={a.model + "\n"} b={b.model + "\n"} />
          <Diff t={t} title="Instructions" a={instructionsText(a.instructions)} b={instructionsText(b.instructions)} />
          <Diff t={t} title={t("工具")} a={JSON.stringify(a.tools, null, 2)} b={JSON.stringify(b.tools, null, 2)} />
          <Diff t={t} title={t("參數")} a={JSON.stringify(a.settings, null, 2)} b={JSON.stringify(b.settings, null, 2)} />
        </>
      )}
    </div>
  );
}
