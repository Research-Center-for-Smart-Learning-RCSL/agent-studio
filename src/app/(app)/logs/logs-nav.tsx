"use client";
import { usePathname, useRouter } from "next/navigation";
import { Tabs } from "antd";
import { useI18n } from "@/lib/i18n-client";

type Item = { key: string; href: string; label: string; adminOnly?: boolean };

export function LogsNav({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const items: Item[] = [
    { key: "conversations", href: "/logs", label: t("對話") },
    { key: "turns", href: "/logs/turns", label: t("回合") },
    { key: "speech", href: "/logs/speech", label: t("語音") },
    { key: "bookmarks", href: "/logs/bookmarks", label: t("書籤") },
    { key: "exports", href: "/logs/exports", label: t("匯出") },
    { key: "analytics", href: "/logs/analytics", label: t("分析"), adminOnly: true },
    { key: "feedback", href: "/logs/feedback", label: t("意見板") },
    { key: "health", href: "/logs/health", label: t("擷取狀態"), adminOnly: true },
    { key: "users", href: "/logs/users", label: t("帳號"), adminOnly: true },
  ];
  const visible = items.filter((item) => isAdmin || !item.adminOnly);
  const active = visible
    .filter((item) => item.href === "/logs" ? pathname === "/logs" || pathname.startsWith("/logs/conversations") : pathname.startsWith(item.href))
    .at(0)?.key;
  return (
    <Tabs
      activeKey={active}
      onChange={(key) => {
        const target = visible.find((item) => item.key === key);
        if (target) router.push(target.href);
      }}
      items={visible.map((item) => ({ key: item.key, label: item.label }))}
    />
  );
}
