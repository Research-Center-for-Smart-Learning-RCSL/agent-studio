import { requireUser } from "@/lib/authz";
import { getTranslator } from "@/lib/i18n-server";
import { logsConfigured } from "@/lib/logs";
import { LogsProvider } from "./logs-client";
import { LogsNav } from "./logs-nav";
import styles from "./logs.module.css";

export default async function LogsLayout({ children }: LayoutProps<"/logs">) {
  const t = await getTranslator();
  const user = await requireUser();
  if (!logsConfigured()) {
    return (
      <section className="studio-panel" style={{ padding: 24 }}>
        <h1 style={{ marginTop: 0 }}>Logs</h1>
        <p>{t("Logs 尚未設定")}</p>
      </section>
    );
  }
  return (
    <LogsProvider userEmail={user.email}>
      <div className={`${styles.page} studio-logs`}>
        <LogsNav isAdmin={user.isAdmin} />
        {children}
      </div>
    </LogsProvider>
  );
}
