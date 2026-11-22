"use client";

import { ConfigProvider, type ThemeConfig } from "antd";
import type { ReactNode } from "react";

const theme: ThemeConfig = {
  token: {
    colorPrimary: "#0d6b53",
    colorLink: "#0d6b53",
    colorText: "#172924",
    colorTextSecondary: "#526760",
    colorBorder: "#d2ded8",
    borderRadius: 8,
    controlHeight: 38,
    fontFamily: "var(--studio-font)",
  },
  components: {
    Table: {
      headerBg: "#f1f6f3",
      headerColor: "#40574e",
      rowHoverBg: "#f4faf7",
      borderColor: "#e5ede8",
    },
  },
};

export function StudioTheme({ children }: { children: ReactNode }) {
  return <ConfigProvider theme={theme}>{children}</ConfigProvider>;
}
