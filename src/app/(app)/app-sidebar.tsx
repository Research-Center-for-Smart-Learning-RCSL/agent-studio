"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppstoreOutlined, FileSearchOutlined, MenuFoldOutlined, MenuOutlined, MenuUnfoldOutlined, SettingOutlined } from "@ant-design/icons";
import { useI18n } from "@/lib/i18n-client";
import { DirectoryRobot } from "./directory-robot";

export type SidebarKey = "agents" | "logs" | "admin";

const icons: Record<SidebarKey, ReactNode> = {
  agents: <AppstoreOutlined />,
  logs: <FileSearchOutlined />,
  admin: <SettingOutlined />,
};

const hrefs: Record<SidebarKey, string> = { agents: "/", logs: "/logs", admin: "/admin" };

function activeKey(pathname: string): SidebarKey | undefined {
  if (pathname === "/" || pathname.startsWith("/agents")) return "agents";
  if (pathname.startsWith("/logs")) return "logs";
  if (pathname.startsWith("/admin")) return "admin";
}

const storageKey = "agent-studio:sidebar-collapsed";

export function AppSidebar({ items }: { items: { key: SidebarKey; label: string }[] }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const current = activeKey(pathname);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey) === "1";
      queueMicrotask(() => setCollapsed(saved));
    } catch { /* Storage can be unavailable. */ }
  }, []);

  // Following a link on a phone should reveal the page, not leave the menu over it.
  useEffect(() => {
    queueMicrotask(() => setOpen(false));
  }, [pathname]);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* Storage is optional. */ }
  }

  return (
    <>
      <button
        type="button"
        className="studio-menu-button"
        aria-label={t("開啟選單")}
        aria-expanded={open}
        aria-controls="studio-sidebar"
        onClick={() => setOpen(true)}
      >
        <MenuOutlined />
      </button>
      {open && <div className="studio-sidebar-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside id="studio-sidebar" className={`studio-sidebar${collapsed ? " is-collapsed" : ""}${open ? " is-open" : ""}`}>
        <div className="studio-sidebar-top">
          <Link href="/" className="studio-brand" title="RCSL Agent Studio">
            <span className="studio-mark" aria-hidden="true" />
            <span className="studio-brand-name">RCSL Agent Studio</span>
          </Link>
          <button
            type="button"
            className="studio-collapse studio-collapse-top"
            aria-label={collapsed ? t("展開側欄") : t("收合側欄")}
            aria-pressed={collapsed}
            title={collapsed ? t("展開側欄") : t("收合側欄")}
            onClick={toggleCollapsed}
          >
            <span className="studio-nav-icon" aria-hidden="true">{collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}</span>
          </button>
        </div>
        <nav className="studio-nav" aria-label={t("主導覽")}>
          {items.map((item) => (
            <Link
              key={item.key}
              href={hrefs[item.key]}
              className={current === item.key ? "is-active" : undefined}
              aria-current={current === item.key ? "page" : undefined}
              title={item.label}
            >
              <span className="studio-nav-icon" aria-hidden="true">{icons[item.key]}</span>
              <span className="studio-nav-label">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="studio-sidebar-mascot">
          <DirectoryRobot size="compact" variant="sidebar" />
        </div>
        <button
          type="button"
          className="studio-collapse"
          aria-label={collapsed ? t("展開側欄") : t("收合側欄")}
          aria-pressed={collapsed}
          title={collapsed ? t("展開側欄") : t("收合側欄")}
          onClick={toggleCollapsed}
        >
          <span className="studio-nav-icon" aria-hidden="true">{collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}</span>
          <span className="studio-nav-label">{t("收合側欄")}</span>
        </button>
      </aside>
    </>
  );
}
