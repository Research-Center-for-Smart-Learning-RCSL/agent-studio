"use client";
import { createContext, Fragment, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ConfigProvider } from "antd";
import zhTW from "antd/locale/zh_TW";
import enUS from "antd/locale/en_US";
import plPL from "antd/locale/pl_PL";
import { type Locale, translate, translateError } from "./i18n";

type ContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, values?: unknown[]) => string;
  /** Like t, for sentences that contain elements: each {n} in the translation is replaced by nodes[n], so word order stays the translator's. */
  rich: (key: string, nodes: ReactNode[]) => ReactNode;
  error: (message: string) => string;
};
const Context = createContext<ContextValue | null>(null);
export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, setCurrentLocale] = useState(initialLocale);
  const router = useRouter();
  const value = useMemo<ContextValue>(() => ({
    locale,
    t: (key, values) => translate(locale, key, values),
    rich: (key, nodes) => translate(locale, key).split(/(\{\d+\})/).map((part, index) => {
      const slot = /^\{(\d+)\}$/.exec(part);
      return slot ? <Fragment key={index}>{nodes[Number(slot[1])]}</Fragment> : part;
    }),
    error: (message) => translateError(locale, message),
    setLocale: (next) => {
      document.cookie = `studio-locale=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = next;
      setCurrentLocale(next);
      router.refresh();
    },
  }), [locale, router]);
  return <Context.Provider value={value}><ConfigProvider locale={locale === "pl" ? plPL : locale === "en" ? enUS : zhTW}>{children}</ConfigProvider></Context.Provider>;
}
export function useI18n() {
  const value = useContext(Context);
  if (!value) throw new Error("I18nProvider missing");
  return value;
}
export function LanguageSelect() {
  const { locale, setLocale } = useI18n();
  return <select className="language-select" aria-label="Language / 語言 / Język" value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
    <option value="zh-Hant">繁體中文</option><option value="en">English</option><option value="pl">Polski</option>
  </select>;
}
