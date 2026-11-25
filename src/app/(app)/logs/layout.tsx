import { requireUser } from "@/lib/authz";
import { getTranslator } from "@/lib/i18n-server";
import { logsConfigured } from "@/lib/logs";
import { LogsProvider } from "./logs-client";
import { LogsNav } from "./logs-nav";
import styles from "./logs.module.css";
import { DirectoryRobot } from "../directory-robot";

export default async function LogsLayout({ children }: LayoutProps<"/logs">) {
  const t = await getTranslator();
  const user = await requireUser();
  if (!logsConfigured()) {
    return (
      <section className="studio-panel" style={{ padding: 24 }}>
        <div className={styles.masthead}>
          <h1>Logs</h1>
          <DirectoryRobot variant="logs" />
        </div>
        <p>{t("Logs 尚未設定")}</p>
      </section>
    );
  }
  return (
    <LogsProvider userEmail={user.email}>
      <div className={`${styles.page} studio-logs`}>
        <div className={styles.masthead}>
          <h1>Logs</h1>
          <DirectoryRobot variant="logs" />
        </div>
        <LogsNav isAdmin={user.isAdmin} />
        {children}
      </div>
    </LogsProvider>
  );
}
