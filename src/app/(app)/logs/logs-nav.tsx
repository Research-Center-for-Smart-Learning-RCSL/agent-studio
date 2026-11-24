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
