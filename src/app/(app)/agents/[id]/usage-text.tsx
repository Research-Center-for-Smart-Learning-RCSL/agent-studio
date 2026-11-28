"use client";
import { Typography } from "antd";
import { usageParts, type AgentUsage } from "@/lib/agent-usage";
import { formatTaipei } from "@/lib/format-time";
import { useI18n } from "@/lib/i18n-client";

export function UsageText(props: { usage: AgentUsage }) {
  const { t, locale } = useI18n();
  return (
    <Typography.Text type="secondary" style={{ display: "block", fontSize: 12, marginTop: 4 }}>
      {usageParts(props.usage, t, (iso) => formatTaipei(iso, locale, false)).join(" · ")}
    </Typography.Text>
  );
}
