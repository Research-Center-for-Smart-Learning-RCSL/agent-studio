import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { StudioTheme } from "./studio-theme";
import "./globals.css";
import { getLocale } from "@/lib/i18n-server";
import { I18nProvider } from "@/lib/i18n-client";

export const metadata: Metadata = {
  title: "RCSL Agent Studio",
  description: "Author and version RCSL agents",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>
        <AntdRegistry><I18nProvider initialLocale={locale}><StudioTheme>{children}</StudioTheme></I18nProvider></AntdRegistry>
      </body>
    </html>
  );
}
