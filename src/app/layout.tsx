import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { StudioTheme } from "./studio-theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Studio",
  description: "Author and version RCSL agents",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant">
      <body>
        <AntdRegistry><StudioTheme>{children}</StudioTheme></AntdRegistry>
      </body>
    </html>
  );
}
