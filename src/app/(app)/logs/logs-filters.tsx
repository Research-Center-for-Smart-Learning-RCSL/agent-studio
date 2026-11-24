"use client";
import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Checkbox, Input, Select } from "antd";
import { useI18n } from "@/lib/i18n-client";
import { badRange, emptyFilters, filterParams, type ListFilters } from "@/lib/logs-format";
import { SearchSyntaxHelp } from "./logs-ui";
import styles from "./logs.module.css";

const keys = Object.keys(emptyFilters) as (keyof ListFilters)[];

/** The list's filters live in the address, so Back from a conversation returns to the same search. */
export function useUrlFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const filters = useMemo(() => {
    const next = { ...emptyFilters };
    for (const key of keys) next[key] = search.get(key) ?? "";
    return next;
  }, [search]);
  const set = useCallback((patch: Partial<ListFilters>) => {
    const params = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, search]);
  const params = useMemo(() => filterParams(filters), [filters]);
  return { filters, params, set, reset: () => router.replace(pathname, { scroll: false }), bad: badRange(filters) };
}

/** Text that is applied on Enter or when it loses focus, not on every keystroke. */
function CommitInput({ value, onCommit, ...props }: { value: string; onCommit: (value: string) => void } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
  const [draft, setDraft] = useState<{ from: string; text: string }>({ from: value, text: value });
  // A change from outside (Clear, Back) replaces what was being typed.
  const text = draft.from === value ? draft.text : value;
  const commit = () => { if (text.trim() !== value) onCommit(text.trim()); };
  return <Input {...props} value={text} onChange={(e) => setDraft({ from: value, text: e.target.value })} onPressEnter={commit} onBlur={commit} />;
}

export function FilterBar({ filters, set, reset, bad, showStatus = false, searchPlaceholder }: {
  filters: ListFilters; set: (patch: Partial<ListFilters>) => void; reset: () => void; bad: boolean; showStatus?: boolean; searchPlaceholder: string;
}) {
  const { t } = useI18n();
  const active = keys.some((key) => filters[key] !== "");
  return (
    <div>
      <div className={styles.filters} role="search">
        <CommitInput className={styles.search} allowClear value={filters.q} placeholder={searchPlaceholder} aria-label={t("搜尋")} onCommit={(q) => set({ q })} />
        <Select
          style={{ width: 130 }}
          allowClear
          placeholder={t("執行環境")}
          value={filters.runtime || undefined}
          onChange={(runtime) => set({ runtime: runtime ?? "" })}
          options={[{ value: "robot", label: t("機器人") }, { value: "web", label: t("網頁") }]}
        />
        {showStatus && (
          <Select
            style={{ width: 130 }}
            allowClear
            placeholder={t("狀態")}
            value={filters.status || undefined}
            onChange={(status) => set({ status: status ?? "" })}
            options={[{ value: "ok", label: t("成功") }, { value: "failed", label: t("失敗") }, { value: "no_response", label: t("無回應") }]}
          />
        )}
        <CommitInput style={{ width: 150 }} allowClear value={filters.robot} placeholder={t("機器人序號")} aria-label={t("機器人序號")} onCommit={(robot) => set({ robot })} />
        <Input style={{ width: 150 }} type="date" value={filters.since} aria-label={t("起日")} onChange={(e) => set({ since: e.target.value })} />
        <Input style={{ width: 150 }} type="date" value={filters.until} aria-label={t("迄日")} onChange={(e) => set({ until: e.target.value })} />
        <Checkbox checked={filters.bookmarked === "1"} onChange={(e) => set({ bookmarked: e.target.checked ? "1" : "" })}>{t("只看書籤")}</Checkbox>
        {active && <Button type="link" onClick={reset}>{t("清除條件")}</Button>}
      </div>
      {bad && <Alert style={{ marginBlockStart: 8 }} type="warning" showIcon title={t("起日晚於迄日，不會有任何結果")} />}
      <SearchSyntaxHelp />
    </div>
  );
}
