import { getTranslator } from "@/lib/i18n-server";

export default async function LogsPage() {
  const t = await getTranslator();
  return (
    <section className="studio-panel" style={{ padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Logs</h1>
      <p>{t("Logs 整合進行中，尚未連線。")}</p>
    </section>
  );
}
