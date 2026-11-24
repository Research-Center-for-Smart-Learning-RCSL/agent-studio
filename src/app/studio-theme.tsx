"use client";

import { ConfigProvider, type ThemeConfig } from "antd";
import type { ReactNode } from "react";

const theme: ThemeConfig = {
  token: {
    colorPrimary: "#4b6780",
    colorLink: "#4b6780",
    colorText: "#253544",
    colorTextSecondary: "#526473",
    colorBorder: "#cbd5dd",
    borderRadius: 8,
    controlHeight: 38,
    fontFamily: "var(--studio-font)",
  },
  components: {
    Table: {
      headerBg: "#edf2f5",
      headerColor: "#405464",
      rowHoverBg: "#f1f5f8",
      borderColor: "#e1e8ed",
    },
  },
};

export function StudioTheme({ children }: { children: ReactNode }) {
  return <ConfigProvider theme={theme}>{children}</ConfigProvider>;
}
